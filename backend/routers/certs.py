import io
import re
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from auth import get_current_user
from config import get_config
from lib.nebula import list_certs, print_cert, create_cert

router = APIRouter(prefix="/certs", tags=["certs"])


@router.get("")
async def get_certs(_: str = Depends(get_current_user)):
    certs = await list_certs()
    return {"certs": certs}


@router.get("/ca")
async def get_ca_cert(_: str = Depends(get_current_user)):
    cfg = get_config()
    ca_path = cfg["nebula"]["ca_cert_path"]
    data = await print_cert(ca_path)
    if not data:
        raise HTTPException(status_code=404, detail="CA cert not found or unreadable")
    return {"ca": data}


@router.get("/{name}")
async def get_cert(name: str, _: str = Depends(get_current_user)):
    _validate_name(name)
    cfg = get_config()
    certs_dir = cfg["nebula"]["certs_dir"]
    cert_path = Path(certs_dir) / f"{name}.crt"
    if not cert_path.exists():
        raise HTTPException(status_code=404, detail="Cert not found")
    data = await print_cert(str(cert_path))
    if not data:
        raise HTTPException(status_code=500, detail="Failed to read cert")
    return {"cert": data, "path": str(cert_path)}


class CreateCertRequest(BaseModel):
    name: str
    ip: str          # e.g. "10.120.1.50/16"
    groups: list[str] = []
    duration: str = ""  # e.g. "8760h0m0s" for 1 year

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$', v):
            raise ValueError("Invalid name: letters, numbers, hyphens, underscores, dots only")
        return v

    @field_validator("ip")
    @classmethod
    def validate_ip(cls, v: str) -> str:
        import ipaddress
        try:
            ipaddress.ip_interface(v)
        except ValueError:
            raise ValueError("Invalid IP/CIDR format. Use e.g. 10.120.1.50/16")
        return v


@router.post("")
async def create_new_cert(body: CreateCertRequest, _: str = Depends(get_current_user)):
    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    if (certs_dir / f"{body.name}.crt").exists():
        raise HTTPException(status_code=409, detail=f"Cert '{body.name}' already exists")

    ok, result = await create_cert(
        name=body.name,
        ip_cidr=body.ip,
        groups=body.groups or None,
        duration=body.duration or None,
    )
    if not ok:
        raise HTTPException(status_code=500, detail=result)
    return {"message": f"Cert created: {body.name}", "path": result}


@router.get("/{name}/download")
async def download_cert(name: str, _: str = Depends(get_current_user)):
    _validate_name(name)
    cfg = get_config()
    certs_dir = Path(cfg["nebula"]["certs_dir"])
    crt_path = certs_dir / f"{name}.crt"
    key_path = certs_dir / f"{name}.key"

    if not crt_path.exists():
        raise HTTPException(status_code=404, detail="Cert not found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(crt_path, f"{name}.crt")
        if key_path.exists():
            zf.write(key_path, f"{name}.key")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}-nebula.zip"'},
    )


def _validate_name(name: str) -> None:
    if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$', name):
        raise HTTPException(status_code=400, detail="Invalid cert name")
