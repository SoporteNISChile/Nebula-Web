import asyncio
from datetime import datetime, timezone
from fastapi import APIRouter, Depends

from auth import get_current_user
from config import get_config
from database import get_handshake_history, get_last_seen_map
from lib.nebula import list_certs, get_recent_handshakes, get_tunnel_states

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
    certs_task = asyncio.create_task(list_certs())
    recent_task = asyncio.create_task(get_recent_handshakes(minutes=60))
    tunnel_task = asyncio.create_task(get_tunnel_states(hours=24))

    certs = await certs_task
    recent = await recent_task
    tunnel_states = await tunnel_task

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
        status, last_seen = _node_status(name, tunnel_states)
        nodes.append({
            **cert,
            "last_seen": last_seen,
            "status": status,
            "active": status == "active",
        })

    return {"nodes": nodes, "recent_handshakes": recent[:20]}


@router.get("/{name}/history")
async def node_history(name: str, limit: int = 100, _: str = Depends(get_current_user)):
    history = await get_handshake_history(cert_name=name, limit=limit)
    return {"cert_name": name, "history": history}
