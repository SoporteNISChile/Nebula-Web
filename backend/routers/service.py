from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from config import get_config
from lib.systemd import get_service_status, get_service_file, service_action

router = APIRouter(prefix="/service", tags=["service"])


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


class ActionRequest(BaseModel):
    action: str


@router.post("/action")
async def perform_action(body: ActionRequest, _: str = Depends(get_current_user)):
    allowed = {"start", "stop", "restart", "reload"}
    if body.action not in allowed:
        raise HTTPException(status_code=400, detail=f"Action must be one of: {', '.join(allowed)}")
    cfg = get_config()
    ok, msg = await service_action(cfg["nebula"]["service_name"], body.action)
    if not ok:
        raise HTTPException(status_code=500, detail=msg)
    return {"message": msg}
