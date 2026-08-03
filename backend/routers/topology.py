import asyncio
import aiosqlite
from fastapi import APIRouter, Depends
from auth import get_current_user
from config import get_config
from lib.nebula import list_certs, get_recent_handshakes, get_tunnel_states, get_local_node_name

router = APIRouter(prefix="/topology", tags=["topology"])

_SERVER_GROUPS = {"server", "servers", "relay", "relays"}


def _extract_ip(networks: list) -> str | None:
    if networks:
        return networks[0].split("/")[0]
    return None


def _strip_port(raw: str) -> str:
    if not raw:
        return raw
    parts = raw.rsplit(":", 1)
    return parts[0].strip("[]") if len(parts) == 2 else raw


async def _last_public_ips_from_db() -> dict[str, str]:
    """Query handshake_events for the most recent public IP per cert."""
    cfg = get_config()
    db_path = cfg.get("database", {}).get("path", "./nebula-web.db")
    result: dict[str, str] = {}
    try:
        async with aiosqlite.connect(db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT cert_name, remote_addr FROM handshake_events "
                "WHERE remote_addr != '' ORDER BY ts DESC"
            )
            rows = await cursor.fetchall()
        for row in rows:
            cn = row["cert_name"]
            if cn not in result:
                ip = _strip_port(row["remote_addr"])
                if ip:
                    result[cn] = ip
    except Exception:
        pass
    return result


def _node_layer(groups: list) -> str:
    for g in groups:
        if g.lower() in _SERVER_GROUPS:
            return "servers"
    return "clients"


@router.get("/ips")
async def get_public_ips(_: str = Depends(get_current_user)):
    """Last known public IP per cert from handshake DB."""
    return await _last_public_ips_from_db()


@router.get("")
async def get_topology(_: str = Depends(get_current_user)):
    certs, tunnel_states, local_name, db_ips = await asyncio.gather(
        list_certs(),
        get_tunnel_states(hours=24),
        get_local_node_name(),
        _last_public_ips_from_db(),
    )

    lighthouse_node = None
    nodes = []

    for cert in certs:
        name = cert.get("name", cert["filename"])
        vpn_ip = _extract_ip(cert.get("networks", []))
        public_ip = db_ips.get(name)
        groups = cert.get("groups") or []

        state = tunnel_states.get(name, {})
        s = state.get("state")
        status = "active" if s == "active" else ("disconnected" if s == "disconnected" else "offline")

        node = {
            "name": name,
            "vpn_ip": vpn_ip,
            "public_ip": public_ip,
            "groups": groups,
            "status": status,
            "layer": _node_layer(groups),
        }

        if local_name and name == local_name:
            lighthouse_node = node
        else:
            nodes.append(node)

    return {"lighthouse": lighthouse_node, "nodes": nodes}
