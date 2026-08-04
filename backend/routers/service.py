import asyncio
from collections import deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import get_current_user
from config import get_config
from database import log_audit
from lib.systemd import get_service_status, get_service_file, service_action

router = APIRouter(prefix="/service", tags=["service"])

_THRESHOLD = 85.0
_resource_history: deque = deque(maxlen=180)  # 30min of 10s samples


async def _read_resources() -> dict:
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.5)
        ram = psutil.virtual_memory().percent
        disk = psutil.disk_usage("/").percent
        return {"cpu": round(cpu, 1), "ram": round(ram, 1), "disk": round(disk, 1)}
    except ImportError:
        pass

    # Shell fallback (Linux /proc)
    try:
        import re
        mem_text = open("/proc/meminfo").read()
        total = int(re.search(r"MemTotal:\s+(\d+)", mem_text).group(1))
        available = int(re.search(r"MemAvailable:\s+(\d+)", mem_text).group(1))
        ram = round((total - available) / total * 100, 1)
    except Exception:
        ram = 0.0

    try:
        proc = await asyncio.create_subprocess_exec(
            "df", "/", "--output=pcent",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        disk = float(out.decode().strip().splitlines()[-1].replace("%", ""))
    except Exception:
        disk = 0.0

    # CPU: two /proc/stat reads 0.5s apart
    def _stat():
        line = open("/proc/stat").readline().split()
        vals = [int(x) for x in line[1:]]
        idle = vals[3]
        total = sum(vals)
        return idle, total

    try:
        i1, t1 = _stat()
        await asyncio.sleep(0.5)
        i2, t2 = _stat()
        dt = t2 - t1
        cpu = round((1 - (i2 - i1) / dt) * 100, 1) if dt else 0.0
    except Exception:
        cpu = 0.0

    return {"cpu": cpu, "ram": ram, "disk": disk}


async def sample_resources_loop():
    """Background task sampling resources every 10s into a circular buffer."""
    while True:
        try:
            snap = await _read_resources()
            snap["ts"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            _resource_history.append(snap)
        except Exception:
            pass
        await asyncio.sleep(10)


@router.get("/status")
async def status(_: str = Depends(get_current_user)):
    cfg = get_config()
    info = await get_service_status(cfg["nebula"]["service_name"])
    return info


@router.get("/file")
async def service_file(_: str = Depends(get_current_user)):
    cfg = get_config()
    content = await get_service_file(cfg["nebula"]["service_name"])
    return {"content": content}


@router.get("/resources")
async def get_resources(_: str = Depends(get_current_user)):
    history = list(_resource_history)
    current = history[-1] if history else await _read_resources()
    warning = any(current.get(k, 0) >= _THRESHOLD for k in ("cpu", "ram", "disk"))
    return {"current": current, "history": history, "warning": warning, "threshold": _THRESHOLD}


class ActionRequest(BaseModel):
    action: str


@router.post("/action")
async def perform_action(body: ActionRequest, request: Request, actor: str = Depends(get_current_user)):
    allowed = {"start", "stop", "restart", "reload"}
    if body.action not in allowed:
        raise HTTPException(status_code=400, detail=f"Action must be one of: {', '.join(allowed)}")
    cfg = get_config()
    ok, msg = await service_action(cfg["nebula"]["service_name"], body.action)
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    await log_audit(actor, f"service.{body.action}", target=cfg["nebula"]["service_name"], ip=request.client.host)
    return {"message": msg}
