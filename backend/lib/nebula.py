import asyncio
import json
import re
import shlex
from pathlib import Path
from typing import Optional

from config import get_config

# Matches: key=value or key="value with spaces"
_LOGFMT_RE = re.compile(r'(\w+)=("(?:[^"\\]|\\.)*"|[^\s]+)')


def parse_logfmt(line: str) -> dict:
    result = {}
    for key, val in _LOGFMT_RE.findall(line):
        result[key] = val.strip('"')
    return result


def parse_log_line(line: str) -> Optional[dict]:
    """Parse a Nebula log line into a structured dict."""
    parsed = parse_logfmt(line)
    if not parsed:
        return None
    return {
        "time": parsed.get("time", ""),
        "level": parsed.get("level", "info"),
        "msg": parsed.get("msg", line),
        "raw": line,
        "fields": {k: v for k, v in parsed.items() if k not in ("time", "level", "msg")},
    }


async def _run(cmd: list[str]) -> tuple[int, str, str]:
    cfg = get_config()
    if cfg["nebula"]["use_sudo"]:
        cmd = ["sudo", "-n"] + cmd
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace")


async def print_cert(cert_path: str) -> Optional[dict]:
    """Run nebula-cert print -json and return parsed data."""
    cfg = get_config()
    binary = cfg["nebula"]["nebula_cert_binary"]
    code, out, err = await _run([binary, "print", "-json", "-path", cert_path])
    if code != 0:
        return None
    try:
        data = json.loads(out)
        if isinstance(data, list):
            return data[0] if data else None
        return data
    except json.JSONDecodeError:
        return None


async def list_certs() -> list[dict]:
    """List all node certs (excluding ca.crt) with parsed metadata."""
    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    results = []

    for crt_path in sorted(certs_dir.glob("*.crt")):
        if crt_path.name in ("ca.crt",):
            continue
        metadata = await print_cert(str(crt_path))
        entry = {"filename": crt_path.name, "path": str(crt_path)}
        if metadata:
            details = metadata.get("details", {})
            entry.update({
                "name": details.get("name", crt_path.stem),
                "networks": details.get("networks", []),
                "groups": details.get("groups") or [],
                "not_before": details.get("notBefore"),
                "not_after": details.get("notAfter"),
                "fingerprint": metadata.get("fingerprint"),
                "is_ca": details.get("isCa", False),
                "issuer": details.get("issuer"),
            })
        else:
            entry["name"] = crt_path.stem
        results.append(entry)
    return results


async def create_cert(name: str, ip_cidr: str, groups: list[str] = None, duration: str = None) -> tuple[bool, str]:
    """Create a new node certificate using nebula-cert sign."""
    cfg = get_config()
    binary = cfg["nebula"]["nebula_cert_binary"]
    certs_dir = cfg["nebula"]["certs_dir"]
    ca_crt = cfg["nebula"]["ca_cert_path"]
    ca_key = cfg["nebula"]["ca_key_path"]

    # Validate name: alphanumeric + hyphen/underscore/dot only
    if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$', name):
        return False, "Invalid name: use only letters, numbers, hyphens, underscores, dots"

    cmd = [
        binary, "sign",
        "-ca-crt", ca_crt,
        "-ca-key", ca_key,
        "-name", name,
        "-ip", ip_cidr,
        "-out-crt", f"{certs_dir}/{name}.crt",
        "-out-key", f"{certs_dir}/{name}.key",
    ]
    if groups:
        cmd += ["-groups", ",".join(groups)]
    if duration:
        cmd += ["-duration", duration]

    code, out, err = await _run(cmd)
    if code != 0:
        return False, err.strip() or "nebula-cert sign failed"
    return True, f"{certs_dir}/{name}.crt"


async def get_recent_handshakes(minutes: int = 60) -> list[dict]:
    """Parse journalctl for recent handshake events."""
    cfg = get_config()
    service = cfg["nebula"]["service_name"]
    since = f"{minutes} minutes ago"

    code, out, err = await _run([
        "journalctl", "-u", service,
        "--no-pager", "--output=cat",
        f"--since={since}",
    ])
    if code != 0:
        return []

    events = []
    for line in out.splitlines():
        if "Handshake message" not in line:
            continue
        parsed = parse_log_line(line)
        if not parsed:
            continue
        fields = parsed.get("fields", {})
        cert_name = fields.get("certName")
        if not cert_name:
            continue
        events.append({
            "time": parsed["time"],
            "cert_name": cert_name,
            "vpn_addrs": fields.get("vpnAddrs", ""),
            "from": fields.get("from", ""),
            "fingerprint": fields.get("fingerprint", ""),
            "direction": "received" if "received" in parsed["msg"].lower() else "sent",
        })
    return events
