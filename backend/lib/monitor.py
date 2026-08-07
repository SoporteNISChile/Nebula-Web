"""Background alert monitor: detects up/down events for monitored groups and sends Slack.

Node state is persisted in the monitor_state table so that transitions that
happen while this service is down (host reboot, deploy restart) are still
detected and alerted on the first poll after startup.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

import aiohttp

from config import get_config
from database import insert_alert, get_all_cert_meta, get_monitor_state, set_monitor_state
from lib.nebula import list_certs, get_tunnel_states, get_active_peers_from_sshd, get_local_node_name
from lib.systemd import get_service_status

log = logging.getLogger("monitor")

# In-memory state mirror of monitor_state table: {cert_name: "active" | "disconnected" | "offline"}
_node_state: dict[str, str] = {}
_initialized = False


def _extract_ip(networks: list) -> str | None:
    if networks:
        return networks[0].split("/")[0]
    return None


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


async def _record_state(name: str, state: str) -> None:
    _node_state[name] = state
    try:
        await set_monitor_state(name, state)
    except Exception as e:
        log.error("set_monitor_state failed for %s: %s", name, e)


async def _init_state() -> None:
    """Load persisted state from DB. If it exists, the first poll compares
    against it and alerts on transitions that happened while we were down."""
    global _node_state, _initialized
    try:
        persisted = await get_monitor_state()
    except Exception as e:
        log.error("get_monitor_state failed: %s", e)
        persisted = {}
    if persisted:
        _node_state = persisted
        _initialized = True
        log.info("monitor: restored %d node states from DB", len(persisted))
    else:
        log.info("monitor: no persisted state — first poll seeds silently")


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

        if not _initialized or prev is None:
            # First run ever, or new node discovered: seed state, no alert
            await _record_state(name, current)
            continue

        # Detect transition
        was_up = prev == "active"
        is_up = current == "active"

        if was_up and not is_up:
            event = "down"
        elif not was_up and is_up:
            event = "up"
        else:
            if current != prev:
                await _record_state(name, current)
            continue

        await _record_state(name, current)

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
    await _init_state()
    # Startup grace: after a host reboot peers need time to re-handshake.
    # Without this, the first poll would flag every not-yet-reconnected node
    # as down and then immediately send recovery alerts.
    grace: int = cfg.get("alerts", {}).get("startup_grace", 120)
    await asyncio.sleep(grace)
    while True:
        try:
            await _poll_once(cfg)
        except Exception as e:
            log.error("alert_monitor_loop error: %s", e)
        await asyncio.sleep(interval)
