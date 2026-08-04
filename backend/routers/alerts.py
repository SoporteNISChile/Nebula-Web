from fastapi import APIRouter, Depends, Query
from auth import get_current_user
from database import get_alerts

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(
    limit: int = Query(200, ge=1, le=1000),
    cert_name: str = Query(None),
    _=Depends(get_current_user),
):
    entries = await get_alerts(limit=limit, cert_name=cert_name)
    return {"entries": entries}
