from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.providers.manual import ManualInputProvider
from app.context.schemas import ContextIn, ContextIngestResult
from app.context.service import (
    AssetNotFoundError,
    get_asset,
    list_asset_context,
    list_assets,
)
from app.db.session import get_session
from app.reviews.ownership import get_zone_owner
from shared.python.schemas import AreaOwner, Asset, Context

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


@router.get("/assets", response_model=list[Asset])
async def get_assets(
    session: AsyncSession = Depends(get_session),
) -> list[Asset]:
    return await list_assets(session)


@router.get("/assets/{asset_id}/owner", response_model=AreaOwner | None)
async def get_asset_owner(
    asset_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> AreaOwner | None:
    """Zone area owner for an asset — available without an open review."""
    asset = await get_asset(session, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail=f"Asset {asset_id} not found")
    return await get_zone_owner(session, asset.zone)


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
