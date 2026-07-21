"""Webhook ContextProvider — external SCADA/historian-shaped ingest."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.schemas import ContextIn, ContextIngestResult
from app.context.service import AssetNotFoundError, ingest_context


class WebhookReading(BaseModel):
    """One telemetry point from an external historian."""

    metric: str
    value: float
    unit: str | None = None


class WebhookIngestIn(BaseModel):
    """
    External adapter envelope.

    Either pass a full `context` (same shape as POST /context), or a SCADA-style
    `readings` list plus asset_id / asset_name.
    """

    source_system: str = Field(default="scada", min_length=1)
    asset_id: UUID | None = None
    asset_name: str | None = None
    observed_at: datetime | None = None
    readings: list[WebhookReading] | None = None
    category: str | None = None
    payload: dict[str, Any] | None = None
    context: ContextIn | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def require_shape(self) -> WebhookIngestIn:
        if self.context is not None:
            return self
        if self.readings:
            return self
        if self.payload is not None and self.category:
            return self
        raise ValueError(
            "Provide context, or readings[], or category+payload "
            "(plus asset_id or asset_name)"
        )


class WebhookIngestBatchResult(BaseModel):
    results: list[ContextIngestResult]
    count: int


async def resolve_asset_id(
    session: AsyncSession,
    *,
    asset_id: UUID | None,
    asset_name: str | None,
) -> UUID:
    if asset_id is not None:
        exists = await session.execute(
            text("SELECT 1 FROM assets WHERE id = CAST(:id AS uuid)"),
            {"id": str(asset_id)},
        )
        if exists.first() is None:
            raise AssetNotFoundError(asset_id)
        return asset_id
    if not asset_name:
        raise ValueError("asset_id or asset_name is required")
    result = await session.execute(
        text(
            """
            SELECT id FROM assets
            WHERE lower(name) = lower(:name)
            LIMIT 1
            """
        ),
        {"name": asset_name.strip()},
    )
    row = result.first()
    if row is None:
        # Sentinel id — route maps AssetNotFoundError → 404 with generic detail.
        raise AssetNotFoundError(UUID("00000000-0000-0000-0000-000000000000"))
    return row._mapping["id"]


def _payload_from_readings(readings: list[WebhookReading]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for r in readings:
        payload[r.metric] = r.value
        if r.unit:
            payload.setdefault("unit", r.unit)
            payload[f"{r.metric}_unit"] = r.unit
    return payload


class WebhookProvider:
    """Maps external webhook payloads onto the shared ContextProvider seam."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def emit(self, context: ContextIn) -> ContextIngestResult:
        # Force provider tag so audit trail shows the adapter path.
        tagged = context.model_copy(
            update={"provider": context.provider or "webhook"}
        )
        return await ingest_context(self._session, tagged)

    async def ingest(self, body: WebhookIngestIn) -> list[ContextIngestResult]:
        if body.context is not None:
            ctx = body.context.model_copy(
                update={
                    "provider": body.context.provider or body.source_system,
                }
            )
            return [await self.emit(ctx)]

        asset_id = await resolve_asset_id(
            self._session,
            asset_id=body.asset_id,
            asset_name=body.asset_name,
        )
        now = body.observed_at or datetime.now(timezone.utc)

        if body.readings:
            ctx = ContextIn(
                asset_id=asset_id,
                category="sensor",
                payload=_payload_from_readings(body.readings),
                provider=body.source_system,
                valid_from=now,
                confidence=body.confidence,
            )
            return [await self.emit(ctx)]

        assert body.category is not None and body.payload is not None
        ctx = ContextIn(
            asset_id=asset_id,
            category=body.category,
            payload=body.payload,
            provider=body.source_system,
            valid_from=now,
            confidence=body.confidence,
        )
        return [await self.emit(ctx)]
