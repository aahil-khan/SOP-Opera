from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_ops.schemas import (
    AiOpsEventOut,
    AiOpsSummary,
    CostProjectionOut,
    ProviderConnectionOut,
    ProviderStateIn,
    ProviderStateOut,
)
from app.ai_ops.service import get_cost_projection, get_summary, list_recent_events
from app.assessment.provider_state import (
    VALID_PROVIDERS,
    check_provider,
    effective_provider_check,
    set_runtime_provider,
)
from app.db.session import get_session
from app.realtime.connection_manager import manager

router = APIRouter(prefix="/ai-ops", tags=["ai-ops"])


def _provider_state() -> ProviderStateOut:
    check, source, configured_default = effective_provider_check()
    fallback_reason = None
    if source == "auto_default" and check.provider != "ollama":
        fallback_reason = (
            "Ollama was not available, so automatic selection fell through."
        )
    return ProviderStateOut(
        active_provider=check.provider,
        active_model=check.model,
        source=source,
        env_default=configured_default or check.provider,
        configured_default=configured_default,
        connection=ProviderConnectionOut(**check.__dict__),
        fallback_reason=fallback_reason,
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
        if body.provider is not None:
            check = check_provider(body.provider)
            if not check.ok:
                raise HTTPException(
                    status_code=400,
                    detail=f"{check.provider} connection failed: {check.reason}",
                )
        set_runtime_provider(body.provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _provider_state()


@router.post("/provider/test", response_model=ProviderConnectionOut)
async def test_provider_connection(body: ProviderStateIn) -> ProviderConnectionOut:
    """Check a provider without changing the runtime default."""
    provider = body.provider
    if provider is None:
        check, _source, _configured_default = effective_provider_check()
    else:
        check = check_provider(provider)
    if check.provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=check.reason)
    return ProviderConnectionOut(**check.__dict__)


@router.get("/events", response_model=list[AiOpsEventOut])
async def ai_ops_events(
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> list[AiOpsEventOut]:
    """Recent per-assessment outcomes — provider/model stamped on every run."""
    return await list_recent_events(session, limit=limit)


@router.get("/cost-projection", response_model=CostProjectionOut)
async def ai_ops_cost_projection(
    session: AsyncSession = Depends(get_session),
) -> CostProjectionOut:
    """Spend forward-projected from the trailing 30-day rate, at 3/6/12 months."""
    return await get_cost_projection(session)


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
