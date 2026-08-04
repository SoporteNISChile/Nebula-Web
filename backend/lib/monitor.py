"""Background alert monitor: detects up/down events for monitored groups and sends Slack."""
import asyncio
import json
import logging
from datetime import datetime, timezone

import aiohttp

from config import get_config
from database import insert_alert, get_all_cert_meta
from lib.nebula import list_certs, get_tunnel_states, get_active_peers_from_sshd, get_local_node_name
from lib.systemd import get_service_status

log = logging.getLogger("monitor")

# In-memory state: {cert_name: "active" | "disconnected"}
_node_state: dict[str, str] = {}
_initialized = False


def _extract_ip(networks: list) -> str | None:
    if networks:
        return networks[0].split("/")[0]
    return None


def _node_status(name: str, tunnel_states: dict, live_ips: set | None, local_name: str | None, service_running: bool) -> str:
    ip = None
    state = tunnel_states.get(name, {})
    hs = state.get("last_handshake")

    if live_ips is not None and name == local_name and service_running:
        return "active"
    if live_ips is not None:
        return "active" if ip in live_ips else ("disconnected" if hs else "offline")

    tunnel_state = state.get("state")
    if not hs:
        return "offline"
    if tunnel_state == "active":
        return "active"
    return "disconnected"


async def _send_slack(webhook: str, cert_name: str, display_name: str, groups: list, ip: str, event: str) -> bool:
    label = display_name or cert_name
    emoji = ":red_circle:" if event == "down" else ":large_green_circle:"
    verb = "se cayó" if event == "down" else "se recuperó"
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    text = f"{emoji} *{label}* {verb}\nGrupos: {', '.join(groups) or 'sin grupo'} | IP: {ip or '?'} | {ts}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(webhook, json={"text": text}, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                return resp.status == 200
    except Exception as e:
        log.warning("Slack webhook failed: %s", e)
        return False


async def _poll_once(cfg: dict) -> None:
    global _node_state, _initialized

    monitor_groups: list[str] = cfg.get("alerts", {}).get("monitor_groups", [])
    webhook: str = cfg.get("alerts", {}).get("slack_webhook", "")

    if not monitor_groups:
        return

    try:
        certs = await list_certs()
        tunnel_states = await get_tunnel_states(hours=72)
        live_ips = await get_active_peers_from_sshd()
        local_name = await get_local_node_name()
        svc_status = await get_service_status(cfg["nebula"]["service_name"])
        service_running = svc_status.get("running", False)
        cert_meta = await get_all_cert_meta()
    except Exception as e:
        log.warning("monitor poll error: %s", e)
        return

    for cert in certs:
        name = cert.get("name", cert["filename"])
        meta = cert_meta.get(name, {})
        ui_groups: list[str] = meta.get("groups") or []

        # Only monitor certs in monitored groups
        if not any(g in monitor_groups for g in ui_groups):
            continue

        networks = cert.get("networks") or []
        ip = _extract_ip(networks)

        tunnel_state = tunnel_states.get(name, {})
        hs = tunnel_state.get("last_handshake")
        ts_state = tunnel_state.get("state")

        # Determine current status (same logic as nodes.py)
        if name == local_name and service_running:
            current = "active"
        elif live_ips is not None and ip and ip in live_ips:
            current = "active"
        elif not hs:
            current = "offline"
        elif ts_state == "active":
            current = "active"
        else:
            current = "disconnected"

        prev = _node_state.get(name)

        if not _initialized:
            # First run: seed state, no alerts
            _node_state[name] = current
            continue

        if prev is None:
            # New node discovered mid-run
            _node_state[name] = current
            continue

        # Detect transition
        was_up = prev == "active"
        is_up = current == "active"

        if was_up and not is_up:
            event = "down"
        elif not was_up and is_up:
            event = "up"
        else:
            _node_state[name] = current
            continue

        _node_state[name] = current

        display_name = meta.get("display_name") or name
        sent = False
        if webhook:
            sent = await _send_slack(webhook, name, display_name, ui_groups, ip or "", event)

        try:
            await insert_alert(
                cert_name=name,
                display_name=display_name,
                groups=ui_groups,
                ip=ip or "",
                event=event,
                slack_sent=sent,
            )
        except Exception as e:
            log.error("insert_alert failed: %s", e)

    if not _initialized:
        _initialized = True


async def alert_monitor_loop() -> None:
    cfg = get_config()
    interval: int = cfg.get("alerts", {}).get("poll_interval", 60)
    while True:
        try:
            await _poll_once(cfg)
        except Exception as e:
            log.error("alert_monitor_loop error: %s", e)
        await asyncio.sleep(interval)
