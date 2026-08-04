import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator

from auth import get_current_user
from database import get_all_groups, upsert_group, delete_group, log_audit

router = APIRouter(prefix="/groups", tags=["groups"])

_COLOR_RE = re.compile(r'^#[0-9a-fA-F]{6}$')


class GroupBody(BaseModel):
    name: str
    color: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$', v):
            raise ValueError("Invalid group name")
        return v

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        if not _COLOR_RE.match(v):
            raise ValueError("Color must be a hex string like #6366f1")
        return v


class UpdateColorBody(BaseModel):
    color: str

    @field_validator("color")
    @classmethod
    def validate_color(cls, v: str) -> str:
        if not _COLOR_RE.match(v):
            raise ValueError("Color must be a hex string like #6366f1")
        return v


@router.get("")
async def list_groups(_: str = Depends(get_current_user)):
    return {"groups": await get_all_groups()}


@router.post("")
async def create_group(body: GroupBody, request: Request, actor: str = Depends(get_current_user)):
    await upsert_group(body.name, body.color)
    await log_audit(actor, "group.create", target=body.name, detail=f"color={body.color}", ip=request.client.host)
    return {"name": body.name, "color": body.color}


@router.put("/{name}")
async def update_group(name: str, body: UpdateColorBody, request: Request, actor: str = Depends(get_current_user)):
    await upsert_group(name, body.color)
    await log_audit(actor, "group.update", target=name, detail=f"color={body.color}", ip=request.client.host)
    return {"name": name, "color": body.color}


@router.delete("/{name}")
async def remove_group(name: str, request: Request, actor: str = Depends(get_current_user)):
    deleted = await delete_group(name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Group not found")
    await log_audit(actor, "group.delete", target=name, ip=request.client.host)
    return {"deleted": name}
