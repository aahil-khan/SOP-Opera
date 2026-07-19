"""HTTP surface for standalone agent tools (shift handover, etc.)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.nodes.shift_handover import generate_shift_handover
from app.db.session import get_session

router = APIRouter(prefix="/agents", tags=["agents"])


@router.post("/shift-handover")
async def post_shift_handover(
    window_hours: int = Query(default=12, ge=1, le=72),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Generate a generative shift-handover safety brief from recent plant events."""
    return await generate_shift_handover(session, window_hours=window_hours)
