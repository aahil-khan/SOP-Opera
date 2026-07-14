from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.providers.manual import ManualInputProvider
from app.context.schemas import ContextIn, ContextIngestResult
from app.context.service import AssetNotFoundError, list_asset_context
from app.db.session import get_session
from shared.python.schemas import Context

router = APIRouter(tags=["context"])


@router.post("/context", response_model=ContextIngestResult)
async def post_context(
    body: ContextIn,
    session: AsyncSession = Depends(get_session),
) -> ContextIngestResult:
    provider = ManualInputProvider(session)
    try:
        return await provider.emit(body)
    except AssetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/assets/{asset_id}/context", response_model=list[Context])
async def get_asset_context(
    asset_id: UUID,
    limit: int = Query(default=50, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
) -> list[Context]:
    try:
        return await list_asset_context(session, asset_id, limit=limit)
    except AssetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
