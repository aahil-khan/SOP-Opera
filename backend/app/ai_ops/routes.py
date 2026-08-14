from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_ops.schemas import (
    AiOpsEventOut,
    AiOpsSummary,
    ProviderStateIn,
    ProviderStateOut,
)
from app.ai_ops.service import get_summary, list_recent_events
from app.assessment.provider_state import (
    VALID_PROVIDERS,
    get_runtime_provider,
    set_runtime_provider,
)
from app.core.config import get_settings
from app.db.session import get_session
from app.realtime.connection_manager import manager

router = APIRouter(prefix="/ai-ops", tags=["ai-ops"])


def _provider_state() -> ProviderStateOut:
    runtime = get_runtime_provider()
    env_default = get_settings().ai_provider or "mock"
    return ProviderStateOut(
        active_provider=runtime or env_default,
        source="runtime_override" if runtime else "env_default",
        env_default=env_default,
        available=list(VALID_PROVIDERS),
    )


@router.get("/provider", response_model=ProviderStateOut)
async def get_provider_state() -> ProviderStateOut:
    """Which AI provider new assessments will use, and where that comes from."""
    return _provider_state()


@router.put("/provider", response_model=ProviderStateOut)
async def put_provider_state(body: ProviderStateIn) -> ProviderStateOut:
    """Set (or clear with null) the runtime default provider for new assessments."""
    try:
        set_runtime_provider(body.provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _provider_state()


@router.get("/events", response_model=list[AiOpsEventOut])
async def ai_ops_events(
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> list[AiOpsEventOut]:
    """Recent per-assessment outcomes — provider/model stamped on every run."""
    return await list_recent_events(session, limit=limit)


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
