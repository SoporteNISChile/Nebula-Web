import asyncio
import io
import re
import textwrap
import zipfile
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from auth import get_current_user
from config import get_config
from database import (
    get_duplicate_alerts, get_group_colors, get_all_cert_meta,
    set_cert_display_name, delete_cert_meta, set_cert_revoked, set_cert_groups, log_audit,
)
from lib.nebula import list_certs, print_cert, create_cert, get_lighthouse_info, _run

router = APIRouter(prefix="/certs", tags=["certs"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _validate_name(name: str) -> None:
    if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$', name):
        raise HTTPException(status_code=400, detail="Invalid cert name")


def _render_client_config(name: str, lh: dict, install_dir: str = "/etc/nebula") -> str:
    overlay_ip = lh["overlay_ip"]
    port = lh["port"]
    endpoint = lh["public_endpoint"] or f"YOUR_LIGHTHOUSE_PUBLIC_IP:{port}"
    return textwrap.dedent(f"""\
        pki:
          ca: {install_dir}/ca.crt
          cert: {install_dir}/{name}.crt
          key: {install_dir}/{name}.key

        static_host_map:
          "{overlay_ip}": ["{endpoint}"]

        lighthouse:
          am_lighthouse: false
          interval: 30
          hosts:
            - "{overlay_ip}"

        listen:
          host: 0.0.0.0
          port: 0

        punchy:
          punch: true
          respond: true

        relay:
          relays:
            - "{overlay_ip}"
          am_relay: false
          use_relays: true

        tun:
          disabled: false
          dev: nebula1
          mtu: 1300
          drop_local_broadcast: false
          drop_multicast: false

        logging:
          level: info

        firewall:
          outbound:
            - port: any
              proto: any
              host: any
          inbound:
            - port: any
              proto: icmp
              host: any
            - port: any
              proto: any
              host: any
    """)


def _script_linux(name: str) -> str:
    return textwrap.dedent(f"""\
        #!/usr/bin/env bash
        # Nebula installer — Linux/Ubuntu
        # Run as root or with sudo: sudo bash install.sh
        set -euo pipefail

        CERT_NAME="{name}"
        INSTALL_DIR="/etc/nebula"
        BIN="/usr/local/bin/nebula"
        SCRIPT_DIR="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"

        if [ "$EUID" -ne 0 ]; then echo "Run as root: sudo bash $0"; exit 1; fi

        ARCH=$(uname -m)
        case "$ARCH" in
          x86_64)  ARCH_LABEL="amd64" ;;
          aarch64) ARCH_LABEL="arm64" ;;
          armv7*)  ARCH_LABEL="arm-7" ;;
          *)       echo "Unsupported arch: $ARCH"; exit 1 ;;
        esac

        echo "=== Nebula Installer (Linux) — node: $CERT_NAME ==="

        if [ ! -f "$BIN" ]; then
            NEBULA_VERSION=$(curl -fsSL "https://api.github.com/repos/slackhq/nebula/releases/latest" 2>/dev/null \
                | grep -o '"tag_name":"[^"]*"' | cut -d'"' -f4 || echo "v1.11.0")
            [ -z "$NEBULA_VERSION" ] && NEBULA_VERSION="v1.11.0"
            echo "Downloading nebula $NEBULA_VERSION ($ARCH_LABEL)..."
            TMP=$(mktemp -d)
            curl -fsSL "https://github.com/slackhq/nebula/releases/download/${{NEBULA_VERSION}}/nebula-linux-${{ARCH_LABEL}}.tar.gz" \\
                | tar -xz -C "$TMP" nebula
            mkdir -p "$(dirname "$BIN")"
            install -m 755 "$TMP/nebula" "$BIN"
            rm -rf "$TMP"
        else
            echo "nebula binary already present at $BIN"
        fi

        mkdir -p "$INSTALL_DIR"
        install -m 644 "$SCRIPT_DIR/$CERT_NAME.crt" "$INSTALL_DIR/$CERT_NAME.crt"
        install -m 600 "$SCRIPT_DIR/$CERT_NAME.key" "$INSTALL_DIR/$CERT_NAME.key"
        install -m 644 "$SCRIPT_DIR/ca.crt"         "$INSTALL_DIR/ca.crt"
        install -m 644 "$SCRIPT_DIR/config.yml"     "$INSTALL_DIR/config.yml"

        cat > /etc/systemd/system/nebula.service <<'UNIT'
        [Unit]
        Description=Nebula VPN
        After=network.target
        [Service]
        Type=simple
        ExecStart=/usr/local/bin/nebula -config /etc/nebula/config.yml
        Restart=always
        RestartSec=5
        [Install]
        WantedBy=multi-user.target
        UNIT

        systemctl daemon-reload
        systemctl enable nebula
        systemctl restart nebula
        echo ""
        echo "Done. Check: systemctl status nebula"
    """)


def _script_mac(name: str) -> str:
    return textwrap.dedent(f"""\
        #!/usr/bin/env bash
        # Nebula installer — macOS
        # Run as root: sudo bash install.sh
        set -euo pipefail

        CERT_NAME="{name}"
        INSTALL_DIR="/etc/nebula"
        BIN="/usr/local/bin/nebula"
        PLIST="/Library/LaunchDaemons/io.nebula.vpn.plist"
        SCRIPT_DIR="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"

        if [ "$EUID" -ne 0 ]; then echo "Run as root: sudo bash $0"; exit 1; fi

        ARCH=$(uname -m)
        case "$ARCH" in
          x86_64) ARCH_LABEL="amd64" ;;
          arm64)  ARCH_LABEL="arm64" ;;
          *)      echo "Unsupported arch: $ARCH"; exit 1 ;;
        esac

        echo "=== Nebula Installer (macOS) — node: $CERT_NAME ==="

        if [ ! -f "$BIN" ]; then
            NEBULA_VERSION=$(curl -fsSL "https://api.github.com/repos/slackhq/nebula/releases/latest" 2>/dev/null \
                | grep -o '"tag_name":"[^"]*"' | cut -d'"' -f4 || echo "v1.11.0")
            [ -z "$NEBULA_VERSION" ] && NEBULA_VERSION="v1.11.0"
            echo "Downloading nebula $NEBULA_VERSION..."
            TMP=$(mktemp -d)
            curl -fsSL "https://github.com/slackhq/nebula/releases/download/${{NEBULA_VERSION}}/nebula-darwin.zip" \\
                -o "$TMP/nebula-darwin.zip"
            unzip -q "$TMP/nebula-darwin.zip" nebula -d "$TMP"
            mkdir -p "$(dirname "$BIN")"
            install -m 755 "$TMP/nebula" "$BIN"
            rm -rf "$TMP"
        else
            echo "nebula binary already present at $BIN"
        fi

        mkdir -p "$INSTALL_DIR"
        install -m 644 "$SCRIPT_DIR/$CERT_NAME.crt" "$INSTALL_DIR/$CERT_NAME.crt"
        install -m 600 "$SCRIPT_DIR/$CERT_NAME.key" "$INSTALL_DIR/$CERT_NAME.key"
        install -m 644 "$SCRIPT_DIR/ca.crt"         "$INSTALL_DIR/ca.crt"
        install -m 644 "$SCRIPT_DIR/config.yml"     "$INSTALL_DIR/config.yml"

        cat > "$PLIST" <<'PLIST_EOF'
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0"><dict>
            <key>Label</key>           <string>io.nebula.vpn</string>
            <key>ProgramArguments</key>
            <array>
                <string>/usr/local/bin/nebula</string>
                <string>-config</string>
                <string>/etc/nebula/config.yml</string>
            </array>
            <key>RunAtLoad</key>        <true/>
            <key>KeepAlive</key>        <true/>
            <key>ThrottleInterval</key> <integer>5</integer>
            <key>StandardOutPath</key>  <string>/var/log/nebula.log</string>
            <key>StandardErrorPath</key><string>/var/log/nebula.log</string>
        </dict></plist>
        PLIST_EOF

        launchctl bootout system "$PLIST" 2>/dev/null || true
        launchctl bootstrap system "$PLIST"
        echo ""
        echo "Done. Check: sudo launchctl list | grep nebula"
    """)


def _script_windows(name: str) -> str:
    return textwrap.dedent(f"""\
        # Nebula installer — Windows
        # Run in an elevated PowerShell (Run as Administrator)
        #   Right-click PowerShell -> Run as Administrator
        #   Set-ExecutionPolicy Bypass -Scope Process
        #   .\\install.ps1

        $ErrorActionPreference = "Stop"
        $CertName   = "{name}"
        $InstallDir = "C:\\Nebula"
        $BinPath    = "$InstallDir\\nebula.exe"
        $ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path

        Write-Host "=== Nebula Installer (Windows) — node: $CertName ===" -ForegroundColor Cyan

        $IsArm = (Get-WmiObject Win32_Processor).Architecture -eq 12
        $Arch = if ($IsArm) {{ "arm64" }} elseif ([Environment]::Is64BitOperatingSystem) {{ "amd64" }} else {{ "386" }}

        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

        if (-not (Test-Path $BinPath)) {{
            try {{
                $rel = Invoke-RestMethod "https://api.github.com/repos/slackhq/nebula/releases/latest" -UseBasicParsing
                $NebulaVersion = $rel.tag_name
            }} catch {{
                $NebulaVersion = "v1.11.0"
            }}
            Write-Host "Downloading nebula $NebulaVersion ($Arch)..."
            $Url = "https://github.com/slackhq/nebula/releases/download/$NebulaVersion/nebula-windows-$Arch.zip"
            $Zip = "$env:TEMP\\nebula.zip"
            Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
            Expand-Archive -Path $Zip -DestinationPath $InstallDir -Force
            Remove-Item $Zip
        }} else {{
            Write-Host "nebula.exe already present"
        }}

        Copy-Item "$ScriptDir\\$CertName.crt" "$InstallDir\\$CertName.crt" -Force
        Copy-Item "$ScriptDir\\$CertName.key" "$InstallDir\\$CertName.key" -Force
        Copy-Item "$ScriptDir\\ca.crt"        "$InstallDir\\ca.crt"        -Force

        Copy-Item "$ScriptDir\\config.yml" "$InstallDir\\config.yml" -Force

        # Remove any leftover sc.exe service (incompatible with Nebula's startup model)
        if (Get-Service -Name "nebula" -ErrorAction SilentlyContinue) {{
            Stop-Service "nebula" -ErrorAction SilentlyContinue
            sc.exe delete "nebula" | Out-Null
            Start-Sleep -Seconds 1
        }}

        # Remove lingering wintun adapter if present (prevents "file already exists" error)
        $wintunId = pnputil /enum-devices /class net |
            Select-String "SWD\\\\Wintun" | ForEach-Object {{ $_.Line.Trim() -replace '.*:\s*','' }}
        if ($wintunId) {{
            Write-Host "Removing existing wintun adapter: $wintunId"
            pnputil /remove-device $wintunId | Out-Null
            Start-Sleep -Seconds 1
        }}

        # Allow Nebula through Windows Firewall (blocks punchy keep-alive by default)
        Remove-NetFirewallRule -DisplayName "NebulaVPN*" -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName "NebulaVPN Inbound"  -Direction Inbound  -Program $BinPath -Protocol UDP -Action Allow -Profile Any | Out-Null
        New-NetFirewallRule -DisplayName "NebulaVPN Outbound" -Direction Outbound -Program $BinPath -Protocol UDP -Action Allow -Profile Any | Out-Null
        Write-Host "Firewall rules added for nebula.exe (UDP in/out)"

        # Register as Task Scheduler task (runs as SYSTEM, no terminal, auto-restart)
        $taskName = "NebulaVPN"
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

        $action    = New-ScheduledTaskAction -Execute $BinPath -Argument "-config `"$InstallDir\\config.yml`""
        $trigger   = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
        $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
            -Principal $principal -Settings $settings -Force | Out-Null

        Start-ScheduledTask -TaskName $taskName
        Start-Sleep -Seconds 2
        $state = (Get-ScheduledTask -TaskName $taskName).State

        Write-Host ""
        if ($state -eq "Running") {{
            Write-Host "Done. Nebula is running as a system task (state: $state)." -ForegroundColor Green
        }} else {{
            Write-Host "Warning: task state is '$state'. Check C:\\Nebula\\config.yml and re-run." -ForegroundColor Yellow
        }}
        Write-Host "Manage: Start-ScheduledTask NebulaVPN / Stop-ScheduledTask NebulaVPN"
    """)


def _readme(name: str, platform: str, lh: dict) -> str:
    endpoint = lh["public_endpoint"] or f"<YOUR_LIGHTHOUSE_PUBLIC_IP>:{lh['port']}"
    warn = "" if lh["public_endpoint"] else (
        "\n⚠  public_endpoint not configured in nebula-web.config.yml.\n"
        "   Edit config.yml and replace YOUR_LIGHTHOUSE_PUBLIC_IP with the real address.\n"
    )
    cmds = {
        "linux":   "sudo bash install.sh",
        "mac":     "sudo bash install.sh",
        "windows": "Right-click PowerShell → Run as Administrator, then: .\\install.ps1",
    }
    return textwrap.dedent(f"""\
        Nebula install bundle — {name} ({platform})
        ============================================
        {warn}
        Lighthouse overlay IP : {lh['overlay_ip']}
        Lighthouse endpoint   : {endpoint}

        Files in this zip
        -----------------
        {name}.crt      node certificate
        {name}.key      node private key  (keep secret)
        ca.crt          CA certificate
        config.yml      pre-configured nebula config
        install.*       installer script for {platform}

        Quick install
        -------------
        1. Extract this zip to a folder
        2. {cmds[platform]}

        The installer downloads the nebula binary, places all files under
        /etc/nebula (C:\\Nebula on Windows), and installs a system service
        that starts automatically on boot.
    """)


async def _block_and_reload(fingerprint: str, cfg: dict) -> bool:
    """Add fingerprint to pki.blocklist in nebula config, then send SIGHUP."""
    config_path = cfg["nebula"]["config_path"]
    service = cfg["nebula"]["service_name"]

    # Read current config via sudo (file may be root-owned)
    code, out, _ = await _run(["cat", config_path], privileged=True)
    if code != 0:
        return False
    try:
        nebula_cfg = yaml.safe_load(out) or {}
    except yaml.YAMLError:
        return False

    blocklist: list = nebula_cfg.setdefault("pki", {}).setdefault("blocklist", [])
    if fingerprint not in blocklist:
        blocklist.append(fingerprint)

    new_content = yaml.dump(nebula_cfg, default_flow_style=False, allow_unicode=True)

    # Write via sudo tee (stdin pipe)
    proc = await asyncio.create_subprocess_exec(
        "sudo", "-n", "tee", config_path,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate(input=new_content.encode())
    if proc.returncode != 0:
        return False

    # Reload nebula (SIGHUP re-reads config without dropping tunnels)
    await _run(["systemctl", "kill", "--kill-who=main", "--signal=HUP", service], privileged=True)
    return True


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("")
async def get_certs(_: str = Depends(get_current_user)):
    certs = await list_certs()
    duplicates = await get_duplicate_alerts(minutes=15)
    group_colors = await get_group_colors()
    cert_meta = await get_all_cert_meta()
    for cert in certs:
        name = cert.get("name", "")
        cert["duplicate_alert"] = duplicates.get(name) or None
        meta = cert_meta.get(name, {})
        cert["display_name"] = meta.get("display_name") or None
        # attach color of first known group
        for g in (cert.get("groups") or []):
            if g in group_colors:
                cert["group_color"] = group_colors[g]
                break
    return {"certs": certs, "group_colors": group_colors}


@router.get("/ca")
async def get_ca_cert(_: str = Depends(get_current_user)):
    cfg = get_config()
    data = await print_cert(cfg["nebula"]["ca_cert_path"])
    if not data:
        raise HTTPException(status_code=404, detail="CA cert not found or unreadable")
    return {"ca": data}


@router.get("/{name}")
async def get_cert(name: str, _: str = Depends(get_current_user)):
    _validate_name(name)
    cfg = get_config()
    cert_path = Path(cfg["nebula"]["certs_dir"]) / f"{name}.crt"
    if not cert_path.exists():
        raise HTTPException(status_code=404, detail="Cert not found")
    data = await print_cert(str(cert_path))
    if not data:
        raise HTTPException(status_code=500, detail="Failed to read cert")
    return {"cert": data, "path": str(cert_path)}


class RenewCaRequest(BaseModel):
    name: str = "Nebula CA"
    duration: str = "175200h"


@router.post("/ca/renew")
async def renew_ca(body: RenewCaRequest, request: Request, actor: str = Depends(get_current_user)):
    """Regenerate CA and re-sign all active node certs with the new CA."""
    cfg = get_config()
    binary  = cfg["nebula"]["nebula_cert_binary"]
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    ca_crt  = cfg["nebula"]["ca_cert_path"]
    ca_key  = cfg["nebula"]["ca_key_path"]
    service = cfg["nebula"]["service_name"]

    # Snapshot certs BEFORE overwriting CA (print_cert still works on old certs)
    existing  = await list_certs()
    cert_meta = await get_all_cert_meta()

    # Remove existing CA files so nebula-cert ca doesn't refuse to overwrite
    await _run(["rm", "-f", str(ca_crt)], privileged=True)
    await _run(["rm", "-f", str(ca_key)], privileged=True)

    # Generate new CA
    code, _, err = await _run(
        [binary, "ca", "-name", body.name, "-duration", body.duration,
         "-out-crt", str(ca_crt), "-out-key", str(ca_key)],
        privileged=True,
    )
    if code != 0:
        raise HTTPException(status_code=500, detail=f"CA creation failed: {err.strip()}")
    await _run(["chmod", "644", str(ca_crt)], privileged=True)

    # Compute node cert duration: CA expiry minus 1 hour so certs never outlive the CA
    ca_meta = await print_cert(str(ca_crt))
    ca_not_after = ca_meta.get("details", {}).get("notAfter") if ca_meta else None
    if ca_not_after:
        from datetime import datetime, timezone
        ca_expiry = datetime.fromisoformat(ca_not_after.replace("Z", "+00:00"))
        remaining_h = max(1, int((ca_expiry - datetime.now(timezone.utc)).total_seconds() / 3600) - 1)
        node_duration = f"{remaining_h}h"
    else:
        node_duration = body.duration  # fallback

    # Re-sign all non-revoked node certs with the new CA
    resigned: list[str] = []
    failed:   list[dict] = []
    for cert in existing:
        name = cert.get("name", cert["filename"].replace(".crt", ""))
        if cert_meta.get(name, {}).get("revoked"):
            continue
        ip = (cert.get("networks") or [None])[0]
        if not ip:
            continue
        groups = cert.get("groups") or []

        tmp_crt = f"/tmp/nebweb-{name}.crt"
        tmp_key = f"/tmp/nebweb-{name}.key"
        final_crt = str(certs_dir / f"{name}.crt")
        final_key = str(certs_dir / f"{name}.key")

        # Clean up any leftover temp files from a previous failed attempt
        await _run(["rm", "-f", tmp_crt], privileged=True)
        await _run(["rm", "-f", tmp_key], privileged=True)

        # Sign to temp paths first — existing certs are untouched until we know sign succeeds
        cmd = [
            binary, "sign",
            "-ca-crt", str(ca_crt), "-ca-key", str(ca_key),
            "-name", name, "-ip", ip,
            "-out-crt", tmp_crt,
            "-out-key", tmp_key,
            "-duration", node_duration,
        ]
        if groups:
            cmd += ["-groups", ",".join(groups)]

        c, _, e = await _run(cmd, privileged=True)
        if c != 0:
            await _run(["rm", "-f", tmp_crt], privileged=True)
            await _run(["rm", "-f", tmp_key], privileged=True)
            failed.append({"name": name, "error": e.strip()})
            continue

        # Sign succeeded — atomically replace final cert files
        await _run(["rm", "-f", final_crt], privileged=True)
        await _run(["rm", "-f", final_key], privileged=True)
        await _run(["mv", tmp_crt, final_crt], privileged=True)
        await _run(["mv", tmp_key, final_key], privileged=True)
        await _run(["chmod", "644", final_crt], privileged=True)
        resigned.append(name)

    # Clear blocklist — old fingerprints are from the now-untrusted CA
    config_path = cfg["nebula"]["config_path"]
    c, out, _ = await _run(["cat", config_path], privileged=True)
    if c == 0:
        try:
            nebula_cfg = yaml.safe_load(out) or {}
            nebula_cfg.setdefault("pki", {})["blocklist"] = []
            new_yaml = yaml.dump(nebula_cfg, default_flow_style=False, allow_unicode=True)
            proc = await asyncio.create_subprocess_exec(
                "sudo", "-n", "tee", config_path,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate(input=new_yaml.encode())
        except Exception:
            pass

    # Reload nebula so it picks up the new CA
    await _run(["systemctl", "kill", "--kill-who=main", "--signal=HUP", service], privileged=True)

    await log_audit(actor, "cert.ca_renew",
                    detail=f"resigned={len(resigned)}, failed={len(failed)}",
                    ip=request.client.host)
    return {
        "message": f"CA renewed. {len(resigned)} certs re-signed. All nodes must reinstall.",
        "ca_name": body.name,
        "resigned": resigned,
        "failed": failed,
    }


class CreateCertRequest(BaseModel):
    name: str
    ip: str
    groups: list[str] = []
    duration: str = ""

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$', v):
            raise ValueError("Invalid name: letters, numbers, hyphens, underscores, dots only")
        return v

    @field_validator("ip")
    @classmethod
    def validate_ip(cls, v: str) -> str:
        import ipaddress
        try:
            ipaddress.ip_interface(v)
        except ValueError:
            raise ValueError("Invalid IP/CIDR format. Use e.g. 10.120.1.50/16")
        return v


@router.post("")
async def create_new_cert(body: CreateCertRequest, request: Request, actor: str = Depends(get_current_user)):
    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    crt_path = certs_dir / f"{body.name}.crt"

    if crt_path.exists():
        # Allow overwrite only if this cert was previously revoked
        all_meta = await get_all_cert_meta()
        if not all_meta.get(body.name, {}).get("revoked"):
            raise HTTPException(status_code=409, detail=f"Cert '{body.name}' already exists")
        # Remove old (revoked) .crt so nebula-cert can create a fresh one
        await _run(["rm", "-f", str(crt_path)], privileged=True)

    ok, result = await create_cert(
        name=body.name,
        ip_cidr=body.ip,
        groups=body.groups or None,
        duration=body.duration or None,
    )
    if not ok:
        raise HTTPException(status_code=500, detail=result)

    await set_cert_revoked(body.name, False)
    await log_audit(actor, "cert.create", target=body.name,
                    detail=f"ip={body.ip} groups={body.groups}", ip=request.client.host)
    return {"message": f"Cert created: {body.name}", "path": result}


class PatchCertRequest(BaseModel):
    display_name: str | None = None
    groups: list[str] | None = None


@router.patch("/{name}")
async def patch_cert(name: str, body: PatchCertRequest, request: Request, actor: str = Depends(get_current_user)):
    _validate_name(name)
    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    crt_path = certs_dir / f"{name}.crt"
    if not crt_path.exists():
        raise HTTPException(status_code=404, detail="Cert not found")

    if body.display_name is not None:
        await set_cert_display_name(name, body.display_name)

    if body.groups is not None:
        await set_cert_groups(name, body.groups)

    changes = []
    if body.display_name is not None: changes.append(f"display_name={body.display_name}")
    if body.groups is not None: changes.append(f"groups={body.groups}")
    await log_audit(actor, "cert.patch", target=name, detail=", ".join(changes), ip=request.client.host)
    return {"name": name, "display_name": body.display_name}


@router.delete("/{name}")
async def delete_cert(name: str, mode: str = "delete", request: Request = None, actor: str = Depends(get_current_user)):
    """
    mode='delete' — removes .crt + .key, blocks fingerprint, wipes all metadata.
    mode='revoke' — removes .key only (keeps .crt so node stays visible), blocks fingerprint,
                    marks revoked=True in meta so a new cert can be issued for the same name.
    """
    if mode not in ("delete", "revoke"):
        raise HTTPException(status_code=400, detail="mode must be 'delete' or 'revoke'")
    _validate_name(name)
    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    crt_path = certs_dir / f"{name}.crt"
    key_path = certs_dir / f"{name}.key"

    if not crt_path.exists():
        raise HTTPException(status_code=404, detail="Cert not found")

    metadata = await print_cert(str(crt_path))
    fingerprint = metadata.get("fingerprint") if metadata else None

    if mode == "delete":
        await _run(["rm", "-f", str(crt_path)], privileged=True)
        if key_path.exists():
            await _run(["rm", "-f", str(key_path)], privileged=True)
    else:  # revoke — keep .crt so node stays visible, only remove private key
        if key_path.exists():
            await _run(["rm", "-f", str(key_path)], privileged=True)

    blocked = False
    if fingerprint:
        blocked = await _block_and_reload(fingerprint, cfg)

    if mode == "delete":
        await delete_cert_meta(name)
    else:
        await set_cert_revoked(name, True)

    await log_audit(actor, f"cert.{mode}", target=name,
                    detail=f"blocked={blocked}", ip=request.client.host if request else None)
    return {"message": f"Cert '{name}' {mode}d", "blocked": blocked, "mode": mode}


@router.get("/{name}/download")
async def download_cert(name: str, _: str = Depends(get_current_user)):
    """Legacy: cert + key zip only."""
    _validate_name(name)
    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    crt_path = certs_dir / f"{name}.crt"
    key_path = certs_dir / f"{name}.key"
    if not crt_path.exists():
        raise HTTPException(status_code=404, detail="Cert not found")

    buf = io.BytesIO()
    async def _read_priv(path: Path) -> bytes:
        _, out, _ = await _run(["cat", str(path)], privileged=True)
        return out.encode() if isinstance(out, str) else out

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{name}.crt", await _read_priv(crt_path))
        if key_path.exists():
            zf.writestr(f"{name}.key", await _read_priv(key_path))
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}-nebula.zip"'},
    )


@router.get("/{name}/bundle/{platform}")
async def download_bundle(name: str, platform: str, _: str = Depends(get_current_user)):
    """Full install bundle: cert + key + CA + config.yml + platform install script."""
    _validate_name(name)
    if platform not in ("linux", "mac", "windows"):
        raise HTTPException(status_code=400, detail="platform must be: linux, mac, windows")

    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    crt_path = certs_dir / f"{name}.crt"
    key_path = certs_dir / f"{name}.key"
    ca_path  = Path(cfg["nebula"]["ca_cert_path"])

    if not crt_path.exists():
        raise HTTPException(status_code=404, detail="Cert not found")

    lh = await get_lighthouse_info()

    scripts = {
        "linux":   (_script_linux(name),   "install.sh"),
        "mac":     (_script_mac(name),     "install.sh"),
        "windows": (_script_windows(name), "install.ps1"),
    }
    script_content, script_filename = scripts[platform]

    # Key files are 600 (root-owned) — read via sudo cat, use writestr to avoid PermissionError
    async def _read_privileged(path: Path) -> bytes:
        _, out, _ = await _run(["cat", str(path)], privileged=True)
        return out.encode() if isinstance(out, str) else out

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{name}.crt", await _read_privileged(crt_path))
        if key_path.exists():
            zf.writestr(f"{name}.key", await _read_privileged(key_path))
        if ca_path.exists():
            zf.writestr("ca.crt", await _read_privileged(ca_path))
        install_dir = "C:/Nebula" if platform == "windows" else "/etc/nebula"
        zf.writestr("config.yml", _render_client_config(name, lh, install_dir))
        zf.writestr(script_filename, script_content)
        zf.writestr("README.txt", _readme(name, platform, lh))
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}-nebula-{platform}.zip"'},
    )
