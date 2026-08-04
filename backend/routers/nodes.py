import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends

from auth import get_current_user
from config import get_config
from database import get_handshake_history, get_last_seen_map, get_group_colors, get_all_cert_meta, get_duplicate_alerts
from lib.nebula import list_certs, get_recent_handshakes, get_tunnel_states, get_local_node_name, get_active_peers_from_sshd
from lib.systemd import get_service_status

router = APIRouter(prefix="/nodes", tags=["nodes"])


def _extract_ip(networks: list[str]) -> str | None:
    if networks:
        return networks[0].split("/")[0]
    return None


def _node_status(name: str, tunnel_states: dict) -> tuple[str, str | None]:
    """
    Returns (status, last_seen_ts).
    status: 'active' | 'disconnected' | 'offline'
    """
    state = tunnel_states.get(name, {})
    hs = state.get("last_handshake")
    cl = state.get("last_close")

    if not hs:
        return "offline", None

    # last_seen = last handshake (most reliable timestamp we have)
    last_seen = hs

    tunnel_state = state.get("state")
    if tunnel_state == "active":
        return "active", last_seen
    elif tunnel_state == "disconnected":
        return "disconnected", cl or last_seen
    return "offline", last_seen


@router.get("")
async def get_nodes(_: str = Depends(get_current_user)):
    cfg = get_config()
    certs_task      = asyncio.create_task(list_certs())
    recent_task     = asyncio.create_task(get_recent_handshakes())
    tunnel_task     = asyncio.create_task(get_tunnel_states(hours=72))
    hostmap_task    = asyncio.create_task(get_active_peers_from_sshd())
    local_name_task = asyncio.create_task(get_local_node_name())
    service_task    = asyncio.create_task(get_service_status(cfg["nebula"]["service_name"]))
    colors_task     = asyncio.create_task(get_group_colors())
    meta_task       = asyncio.create_task(get_all_cert_meta())
    dup_task        = asyncio.create_task(get_duplicate_alerts(minutes=15))

    certs          = await certs_task
    recent         = await recent_task
    tunnel_states  = await tunnel_task
    live_ips       = await hostmap_task  # set of VPN IPs in Nebula hostmap right now
    local_name     = await local_name_task
    service_running = (await service_task).get("running", False)
    group_colors   = await colors_task
    cert_meta      = await meta_task
    duplicates     = await dup_task

    # Deduplicate: multiple certs with same overlay IP → keep one with most recent handshake
    seen_ips: dict[str, int] = {}  # ip → index in deduped
    deduped: list[dict] = []

    for cert in certs:
        ip = _extract_ip(cert.get("networks") or [])
        if ip and ip in seen_ips:
            existing_idx = seen_ips[ip]
            existing = deduped[existing_idx]
            existing_hs = tunnel_states.get(existing["name"], {}).get("last_handshake")
            new_hs = tunnel_states.get(cert.get("name", ""), {}).get("last_handshake")
            if new_hs and (not existing_hs or new_hs > existing_hs):
                deduped[existing_idx] = cert
                seen_ips[ip] = existing_idx
        else:
            if ip:
                seen_ips[ip] = len(deduped)
            deduped.append(cert)

    nodes = []
    for cert in deduped:
        name = cert.get("name", cert["filename"])
        ip   = _extract_ip(cert.get("networks") or [])
        status, last_seen = _node_status(name, tunnel_states)
        # Real-time hostmap takes priority: if IP is in Nebula's hostmap → definitely active
        if live_ips is not None and ip and ip in live_ips:
            status = "active"
        # Local node (lighthouse) is active whenever the nebula service is running
        if name == local_name and service_running:
            status = "active"
        meta = cert_meta.get(name, {})
        ui_groups = meta.get("groups") or []
        group_color = next(
            (group_colors[g] for g in ui_groups if g in group_colors),
            None,
        )
        nodes.append({
            **cert,
            "groups": ui_groups,
            "last_seen": last_seen,
            "status": status,
            "active": status == "active",
            "display_name": meta.get("display_name") or None,
            "group_color": group_color,
            "duplicate_alert": duplicates.get(name) or None,
            "revoked": meta.get("revoked", False),
        })

    return {"nodes": nodes, "recent_handshakes": recent[:20]}


@router.get("/{name}/history")
async def node_history(name: str, limit: int = 100, _: str = Depends(get_current_user)):
    history = await get_handshake_history(cert_name=name, limit=limit)
    return {"cert_name": name, "history": history}


@router.get("/{name}/ping/stream")
async def ping_node_stream(name: str, count: int = 5, _: str = Depends(get_current_user)):
    """SSE stream of live ping output."""
    from fastapi.responses import StreamingResponse
    from pathlib import Path

    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    crt_path = certs_dir / f"{name}.crt"

    if not crt_path.exists():
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Cert not found")

    from lib.nebula import print_cert as _print_cert
    cert_data = await _print_cert(str(crt_path))
    networks = (cert_data or {}).get("details", {}).get("networks") or []
    if not networks:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="No VPN IP found for this node")

    vpn_ip = networks[0].split("/")[0]
    count = max(1, min(count, 20))

    async def generate():
        yield f"data: PING {vpn_ip} — {count} paquetes\n\n"
        proc = await asyncio.create_subprocess_exec(
            "ping", "-O", "-c", str(count), "-W", "2", vpn_ip,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        try:
            async for raw in proc.stdout:
                line = raw.decode(errors="replace").rstrip()
                if line:
                    yield f"data: {line}\n\n"
            await asyncio.wait_for(proc.wait(), timeout=5)
        except asyncio.TimeoutError:
            proc.kill()
        yield f"data: __done__:{proc.returncode}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
