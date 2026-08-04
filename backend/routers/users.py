from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, field_validator

from auth import hash_password, require_super_admin
from database import get_all_users, get_user, create_user, update_user, delete_user, count_super_admins, log_audit

router = APIRouter(prefix="/users", tags=["users"])

VALID_ROLES = {"admin", "super_admin"}


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "admin"

    @field_validator("password")
    @classmethod
    def pw_len(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("role")
    @classmethod
    def valid_role(cls, v):
        if v not in VALID_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(VALID_ROLES)}")
        return v


class UpdateUserRequest(BaseModel):
    password: str | None = None
    role: str | None = None

    @field_validator("password")
    @classmethod
    def pw_len(cls, v):
        if v is not None and len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("role")
    @classmethod
    def valid_role(cls, v):
        if v is not None and v not in VALID_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(VALID_ROLES)}")
        return v


@router.get("")
async def list_users(_: dict = Depends(require_super_admin)):
    return {"users": await get_all_users()}


@router.post("", status_code=201)
async def add_user(body: CreateUserRequest, request: Request, actor: dict = Depends(require_super_admin)):
    if await get_user(body.username):
        raise HTTPException(status_code=409, detail="Username already exists")
    await create_user(body.username, hash_password(body.password), body.role)
    await log_audit(actor["username"], "user.create", target=body.username,
                    detail=f"role={body.role}", ip=request.client.host)
    return {"username": body.username, "role": body.role}


@router.put("/{username}")
async def edit_user(username: str, body: UpdateUserRequest, request: Request, actor: dict = Depends(require_super_admin)):
    user = await get_user(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role and body.role != "super_admin" and user["role"] == "super_admin":
        if await count_super_admins() <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last super admin")
    pw_hash = hash_password(body.password) if body.password else None
    await update_user(username, password_hash=pw_hash, role=body.role)
    changes = []
    if body.password: changes.append("password")
    if body.role: changes.append(f"role→{body.role}")
    await log_audit(actor["username"], "user.update", target=username,
                    detail=", ".join(changes), ip=request.client.host)
    return {"username": username}


@router.delete("/{username}", status_code=204)
async def remove_user(username: str, request: Request, actor: dict = Depends(require_super_admin)):
    if username == actor["username"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = await get_user(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] == "super_admin" and await count_super_admins() <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last super admin")
    await delete_user(username)
    await log_audit(actor["username"], "user.delete", target=username, ip=request.client.host)
