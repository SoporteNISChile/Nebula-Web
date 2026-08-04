from fastapi import APIRouter, Depends, Query
from auth import get_current_user
from database import get_audit_log

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def list_audit(
    limit: int = Query(default=200, le=1000),
    actor: str = Query(default=None),
    category: str = Query(default=None),
    _: str = Depends(get_current_user),
):
    entries = await get_audit_log(limit=limit, actor=actor or None, action_prefix=category or None)
    return {"entries": entries}
