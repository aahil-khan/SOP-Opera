from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_ops.schemas import AiOpsSummary
from app.ai_ops.service import get_summary
from app.db.session import get_session

router = APIRouter(prefix="/ai-ops", tags=["ai-ops"])


@router.get("/summary", response_model=AiOpsSummary)
async def ai_ops_summary(
    session: AsyncSession = Depends(get_session),
) -> AiOpsSummary:
    return await get_summary(session)
