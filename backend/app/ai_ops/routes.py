from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_ops.schemas import AiOpsSummary
from app.ai_ops.service import get_summary
from app.db.session import get_session
from app.realtime.connection_manager import manager

router = APIRouter(prefix="/ai-ops", tags=["ai-ops"])


@router.get("/summary", response_model=AiOpsSummary)
async def ai_ops_summary(
    session: AsyncSession = Depends(get_session),
) -> AiOpsSummary:
    summary = await get_summary(session)
    # Broadcast backpressure is process-local, so it is attached at the edge
    # rather than computed in the DB-backed service.
    ws = manager.stats()
    return summary.model_copy(
        update={
            "ws_clients": ws["clients"],
            "ws_queue_depth_max": ws["queue_depth_max"],
            "ws_queue_capacity": ws["queue_capacity"],
            "ws_dropped_frames": ws["dropped_frames"],
        }
    )
