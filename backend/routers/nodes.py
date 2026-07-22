from datetime import datetime, timezone
from fastapi import APIRouter, Depends

from auth import get_current_user
from config import get_config
from database import get_handshake_history, get_last_seen_map
from lib.nebula import list_certs, get_recent_handshakes

router = APIRouter(prefix="/nodes", tags=["nodes"])


def _is_active(last_seen_ts: str, threshold: int) -> bool:
    if not last_seen_ts:
        return False
    try:
        ts = datetime.fromisoformat(last_seen_ts.replace("Z", "+00:00"))
        delta = (datetime.now(timezone.utc) - ts).total_seconds()
        return delta < threshold
    except Exception:
        return False


@router.get("")
async def get_nodes(_: str = Depends(get_current_user)):
    cfg = get_config()
    threshold = cfg["logs"]["active_threshold_seconds"]

    certs, last_seen_map, recent = await _gather(threshold)
    nodes = []
    for cert in certs:
        name = cert.get("name", cert["filename"])
        last_seen = last_seen_map.get(name)
        nodes.append({
            **cert,
            "last_seen": last_seen,
            "active": _is_active(last_seen, threshold),
        })
    return {"nodes": nodes, "recent_handshakes": recent[:20]}


async def _gather(threshold):
    import asyncio
    certs_task = asyncio.create_task(list_certs())
    last_seen_task = asyncio.create_task(get_last_seen_map())
    recent_task = asyncio.create_task(get_recent_handshakes(minutes=60))
    return await certs_task, await last_seen_task, await recent_task


@router.get("/{name}/history")
async def node_history(name: str, limit: int = 100, _: str = Depends(get_current_user)):
    history = await get_handshake_history(cert_name=name, limit=limit)
    return {"cert_name": name, "history": history}
