"""Operating-history HTTP surface (W11b)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.history.schemas import HistoryOverviewOut
from app.history.service import DEFAULT_WINDOW_MONTHS, build_overview

router = APIRouter(prefix="/history", tags=["history"])


@router.get("/overview", response_model=HistoryOverviewOut)
async def get_history_overview(
    months: int = Query(DEFAULT_WINDOW_MONTHS, ge=1, le=60),
    session: AsyncSession = Depends(get_session),
) -> HistoryOverviewOut:
    """Fact distribution, verdicts per month and most-cited authorities."""
    return await build_overview(session, months)
