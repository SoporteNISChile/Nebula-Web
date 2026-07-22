import shutil
from datetime import datetime, timezone
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from config import get_config

router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
async def get_nebula_config(_: str = Depends(get_current_user)):
    cfg = get_config()
    path = Path(cfg["nebula"]["config_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Nebula config file not found")
    try:
        content = path.read_text()
        parsed = yaml.safe_load(content)
        return {"path": str(path), "content": content, "parsed": parsed}
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied reading config file")


class ConfigUpdateRequest(BaseModel):
    content: str


@router.put("")
async def update_nebula_config(body: ConfigUpdateRequest, _: str = Depends(get_current_user)):
    cfg = get_config()
    path = Path(cfg["nebula"]["config_path"])

    # Validate YAML before saving
    try:
        yaml.safe_load(body.content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    # Backup current config
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = path.with_suffix(f".yml.bak.{ts}")
    try:
        shutil.copy2(path, backup_path)
        path.write_text(body.content)
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied writing config file")

    return {"message": "Config saved", "backup": str(backup_path)}
