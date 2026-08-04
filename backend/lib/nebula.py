import asyncio
import json
import re
import shlex
from pathlib import Path
from typing import Optional

import yaml
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


async def _run(cmd: list[str], privileged: bool = False) -> tuple[int, str, str]:
    cfg = get_config()
    if privileged or cfg["nebula"]["use_sudo"]:
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
        # Cert may be root-owned 600 — retry with sudo
        code, out, err = await _run([binary, "print", "-json", "-path", cert_path], privileged=True)
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

    code, out, err = await _run(cmd, privileged=True)
    if code != 0:
        return False, err.strip() or "nebula-cert sign failed"
    # Ensure cert is world-readable so the service can read it without sudo
    await _run(["chmod", "644", f"{certs_dir}/{name}.crt"], privileged=True)
    return True, f"{certs_dir}/{name}.crt"


# Matches any Nebula overlay IP in a log line (10.x.y.z)
_OVERLAY_IP_RE = re.compile(r'\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3})\b')


async def _journal_lines(minutes: int) -> list[str]:
    cfg = get_config()
    service = cfg["nebula"]["service_name"]
    code, out, _ = await _run([
        "journalctl", "-u", service,
        "--no-pager", "--output=cat",
        f"--since={minutes} minutes ago",
    ])
    return out.splitlines() if code == 0 else []


def _ts_minus_one(ts: str) -> str:
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return (t - timedelta(seconds=1)).isoformat()
    except Exception:
        return ts


async def get_recent_handshakes(limit: int = 50) -> list[dict]:
    """
    Build connection/disconnection event list from the persistent SQLite DB.

    Uses DB-stored handshake events (populated by the background journalctl
    tail in main.py) so events are never lost when the time window expires.
    Deduplicates handshakes within a 30s window and injects implied disconnects
    when a new handshake follows an existing connection without an explicit close.
    """
    from database import get_handshake_history

    # Fetch enough rows to produce `limit` events after dedup+injection
    rows = await get_handshake_history(limit=limit * 4)

    raw: list[dict] = [
        {
            "time": r["ts"],
            "cert_name": r["cert_name"],
            "vpn_addrs": r.get("vpn_addr") or "",
            "type": "handshake",
        }
        for r in rows
    ]

    # Sort chronologically ascending for state-machine processing
    raw.sort(key=lambda e: e["time"])

    # Deduplicate: drop handshakes within 30s of a prior handshake for same cert
    DEDUP_WINDOW = 30
    deduped: list[dict] = []
    last_hs: dict[str, str] = {}

    for ev in raw:
        prev = last_hs.get(ev["cert_name"])
        if prev:
            try:
                t1 = datetime.fromisoformat(prev.replace("Z", "+00:00"))
                t2 = datetime.fromisoformat(ev["time"].replace("Z", "+00:00"))
                if abs((t2 - t1).total_seconds()) <= DEDUP_WINDOW:
                    continue
            except Exception:
                pass
        last_hs[ev["cert_name"]] = ev["time"]
        deduped.append(ev)

    # Inject implied disconnects between consecutive handshakes for same cert
    events: list[dict] = []
    cert_state: dict[str, str] = {}

    for ev in deduped:
        cert = ev["cert_name"]
        if cert_state.get(cert) == "connected":
            events.append({
                "time": _ts_minus_one(ev["time"]),
                "cert_name": cert,
                "vpn_addrs": ev["vpn_addrs"],
                "type": "disconnect",
                "implied": True,
            })
        cert_state[cert] = "connected"
        events.append(ev)

    def _sort_key(e):
        return (e["time"], 1 if e["type"] == "handshake" else 0)

    return sorted(events, key=_sort_key, reverse=True)[:limit]


async def get_last_activity_by_ip(minutes: int = 15) -> dict[str, str]:
    """Return {overlay_ip: last_seen_ts} from recent log traffic."""
    last: dict[str, str] = {}
    for line in await _journal_lines(minutes):
        parsed = parse_logfmt(line)
        ts = parsed.get("time", "")
        if not ts:
            continue
        for ip in _OVERLAY_IP_RE.findall(line):
            if ip not in last or ts > last[ip]:
                last[ip] = ts
    return last


async def get_tunnel_states(hours: int = 168) -> dict[str, dict]:
    """
    Determine per-cert tunnel state by analysing handshakes, close-tunnel events,
    and tunnel status checks from the last `hours` of logs (default 7 days).

    Returns {cert_name: {last_handshake, last_close, state}}
    state: 'active' | 'disconnected' | None
    """
    states: dict[str, dict] = {}
    for line in await _journal_lines(hours * 60):
        parsed = parse_log_line(line)
        if not parsed:
            continue
        fields = parsed.get("fields", {})
        cert_name = fields.get("certName")
        ts = parsed.get("time", "")
        if not cert_name or not ts:
            continue

        entry = states.setdefault(cert_name, {
            "last_handshake": None,
            "last_close": None,
            "last_dead": None,
        })
        msg = parsed.get("msg", "")

        if "Handshake message received" in msg or "Taking new handshake" in msg:
            if not entry["last_handshake"] or ts > entry["last_handshake"]:
                entry["last_handshake"] = ts
        elif "Close tunnel" in msg or "tearing down" in msg.lower():
            if not entry["last_close"] or ts > entry["last_close"]:
                entry["last_close"] = ts
        elif "Tunnel status" in msg and "state:dead" in msg:
            # Nebula's punchy check detected a dead tunnel
            if not entry["last_dead"] or ts > entry["last_dead"]:
                entry["last_dead"] = ts

    for name, entry in states.items():
        hs = entry["last_handshake"]
        cl = entry["last_close"]
        dead = entry["last_dead"]

        if not hs:
            entry["state"] = None
            continue

        # Latest event wins: if handshake is most recent → active
        latest_negative = max(t for t in (cl, dead) if t) if any((cl, dead)) else None
        if not latest_negative or hs >= latest_negative:
            entry["state"] = "active"
        else:
            entry["state"] = "disconnected"

    return states


async def get_active_peers_from_sshd() -> set[str] | None:
    """
    Query Nebula's built-in SSH management server via `list-hostmap`.
    Returns set of VPN IPs currently in the hostmap, or None if sshd unreachable.
    """
    cfg = get_config()
    sshd_cfg = cfg.get("nebula", {}).get("sshd", {})
    key_path = sshd_cfg.get("key_path", "/opt/nebula-web/nebula_mgmt_key")
    port = int(sshd_cfg.get("port", 2222))
    host = sshd_cfg.get("host", "127.0.0.1")
    user = sshd_cfg.get("user", "nebula")

    code, out, _ = await _run([
        "ssh",
        "-i", key_path,
        "-o", "StrictHostKeyChecking=no",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=3",
        "-p", str(port),
        f"{user}@{host}",
        "list-hostmap",
    ])
    if code != 0 or not out.strip():
        return None

    # Output format: [10.x.y.z]: [endpoint1 endpoint2 ...]
    result: set[str] = set()
    for line in out.splitlines():
        m = re.match(r'^\[([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\]:', line)
        if m:
            result.add(m.group(1))
    return result


async def get_lighthouse_info() -> dict:
    """Extract lighthouse overlay IP and listen port from the local nebula config."""
    cfg = get_config()
    try:
        with open(cfg["nebula"]["config_path"]) as f:
            nebula_cfg = yaml.safe_load(f) or {}

        cert_path = nebula_cfg.get("pki", {}).get("cert")
        overlay_ip = None
        if cert_path:
            metadata = await print_cert(cert_path)
            if metadata:
                nets = metadata.get("details", {}).get("networks", [])
                if nets:
                    overlay_ip = nets[0].split("/")[0]

        raw_port = nebula_cfg.get("listen", {}).get("port", 4242)
        listen_port = int(raw_port) if raw_port else 4242
        if listen_port == 0:
            listen_port = 4242

        public_endpoint = cfg["nebula"].get("public_endpoint", "")

        return {
            "overlay_ip": overlay_ip or "LIGHTHOUSE_OVERLAY_IP",
            "port": listen_port,
            "public_endpoint": public_endpoint,
        }
    except (OSError, yaml.YAMLError):
        return {"overlay_ip": "LIGHTHOUSE_OVERLAY_IP", "port": 4242, "public_endpoint": ""}


async def get_local_node_name() -> Optional[str]:
    """Read nebula config.yml → extract local node cert name."""
    cfg = get_config()
    try:
        with open(cfg["nebula"]["config_path"]) as f:
            nebula_cfg = yaml.safe_load(f) or {}
        cert_path = nebula_cfg.get("pki", {}).get("cert")
        if not cert_path:
            return None
        metadata = await print_cert(cert_path)
        if metadata:
            return metadata.get("details", {}).get("name")
    except (OSError, yaml.YAMLError):
        pass
    return None
