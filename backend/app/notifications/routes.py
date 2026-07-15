from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.notifications.service import list_notifications

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def get_notifications(
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    return await list_notifications(session, limit=limit)
