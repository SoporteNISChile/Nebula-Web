from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, field_validator

from auth import create_token, get_current_user, hash_password, verify_password
from config import get_config, is_setup_complete, save_config

router = APIRouter(prefix="/auth", tags=["auth"])


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
async def login(body: LoginRequest):
    cfg = get_config()
    if not is_setup_complete(cfg):
        raise HTTPException(status_code=403, detail="Setup not complete. Use /api/auth/setup first.")
    if body.username != cfg["auth"]["username"]:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(body.password, cfg["auth"]["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(body.username)
    return {"access_token": token, "token_type": "bearer"}


@router.post("/setup")
async def setup(body: SetupRequest):
    cfg = get_config()
    if is_setup_complete(cfg):
        raise HTTPException(status_code=403, detail="Setup already complete")
    cfg["auth"]["password_hash"] = hash_password(body.password)
    save_config(cfg)
    from config import reload_config
    reload_config()
    return {"message": "Admin password set. You can now log in."}


@router.get("/me")
async def me(current_user: str = Depends(get_current_user)):
    return {"username": current_user}


@router.post("/change-password")
async def change_password(body: LoginRequest, current_user: str = Depends(get_current_user)):
    cfg = get_config()
    if not verify_password(body.password, cfg["auth"]["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password incorrect")
    cfg["auth"]["password_hash"] = hash_password(body.password)
    save_config(cfg)
    from config import reload_config
    reload_config()
    return {"message": "Password changed"}
