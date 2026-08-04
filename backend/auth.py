from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from config import get_config

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(username: str) -> str:
    cfg = get_config()
    expiry = datetime.now(timezone.utc) + timedelta(seconds=cfg["auth"]["token_expiry"])
    return jwt.encode(
        {"sub": username, "exp": expiry},
        cfg["auth"]["jwt_secret"],
        algorithm="HS256",
    )


def _decode_token(raw: str) -> str:
    cfg = get_config()
    try:
        payload = jwt.decode(raw, cfg["auth"]["jwt_secret"], algorithms=["HS256"])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    token: Optional[str] = Query(default=None),  # allows ?token= for download links
) -> str:
    raw = (credentials.credentials if credentials else None) or token
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _decode_token(raw)


async def get_current_user_with_role(username: str = Depends(get_current_user)) -> dict:
    from database import get_user
    user = await get_user(username)
    role = user["role"] if user else "admin"
    return {"username": username, "role": role}


async def require_super_admin(user: dict = Depends(get_current_user_with_role)) -> dict:
    if user["role"] != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return user
