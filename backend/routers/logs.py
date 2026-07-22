import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from auth import get_current_user
from config import get_config
from lib.nebula import parse_log_line

router = APIRouter(prefix="/logs", tags=["logs"])


async def _journalctl(args: list[str]) -> tuple[int, str]:
    cmd = ["journalctl"] + args
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    return proc.returncode, stdout.decode(errors="replace")


@router.get("")
async def get_logs(
    n: int = Query(200, ge=1, le=5000),
    level: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    _: str = Depends(get_current_user),
):
    cfg = get_config()
    service = cfg["nebula"]["service_name"]
    args = ["-u", service, "--no-pager", "--output=cat", f"-n", str(n)]
    if since:
        args += [f"--since={since}"]

    _, out = await _journalctl(args)
    lines = []
    for raw in out.splitlines():
        parsed = parse_log_line(raw)
        if not parsed:
            continue
        if level and parsed["level"] != level:
            continue
        if search and search.lower() not in raw.lower():
            continue
        lines.append(parsed)

    return {"logs": lines, "count": len(lines)}


@router.get("/stream")
async def stream_logs(_: str = Depends(get_current_user)):
    """SSE endpoint for live log streaming."""
    cfg = get_config()
    service = cfg["nebula"]["service_name"]

    async def event_generator():
        cmd = ["journalctl", "-u", service, "--no-pager", "--output=cat", "-f", "-n", "0"]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                raw = line.decode(errors="replace").rstrip()
                if raw:
                    import json
                    parsed = parse_log_line(raw) or {"raw": raw, "level": "info", "msg": raw, "time": ""}
                    yield f"data: {json.dumps(parsed)}\n\n"
        finally:
            proc.kill()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
