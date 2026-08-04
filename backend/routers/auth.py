from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, field_validator

from auth import create_token, get_current_user, get_current_user_with_role, hash_password, verify_password
from config import get_config, is_setup_complete, save_config
from database import get_user, migrate_config_admin, log_audit

router = APIRouter(prefix="/auth", tags=["auth"])


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


class LoginRequest(BaseModel):
    username: str
    password: str


class SetupRequest(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    cfg = get_config()
    if not is_setup_complete(cfg):
        raise HTTPException(status_code=403, detail="Setup not complete. Use /api/auth/setup first.")
    await migrate_config_admin(cfg["auth"]["username"], cfg["auth"]["password_hash"])
    user = await get_user(body.username)
    if not user or not verify_password(body.password, user["password_hash"]):
        await log_audit(body.username, "auth.login_failed", ip=_ip(request))
        raise HTTPException(status_code=401, detail="Invalid credentials")
    await log_audit(body.username, "auth.login", ip=_ip(request))
    token = create_token(body.username)
    return {"access_token": token, "token_type": "bearer", "role": user["role"]}


@router.post("/setup")
async def setup(body: SetupRequest, request: Request):
    cfg = get_config()
    if is_setup_complete(cfg):
        raise HTTPException(status_code=403, detail="Setup already complete")
    pw_hash = hash_password(body.password)
    cfg["auth"]["password_hash"] = pw_hash
    save_config(cfg)
    from config import reload_config
    reload_config()
    from database import create_user
    try:
        await create_user(cfg["auth"]["username"], pw_hash, role="super_admin")
    except Exception:
        pass
    await log_audit(cfg["auth"]["username"], "auth.setup", ip=_ip(request))
    return {"message": "Admin password set. You can now log in."}


@router.get("/me")
async def me(user: dict = Depends(get_current_user_with_role)):
    return {"username": user["username"], "role": user["role"]}


@router.post("/change-password")
async def change_password(body: LoginRequest, request: Request, current_user: str = Depends(get_current_user)):
    user = await get_user(current_user)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password incorrect")
    from database import update_user
    await update_user(current_user, password_hash=hash_password(body.password))
    await log_audit(current_user, "auth.password_change", target=current_user, ip=_ip(request))
    return {"message": "Password changed"}
