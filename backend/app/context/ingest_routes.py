"""External ingest adapters — SCADA/historian webhook → ContextProvider."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.providers.webhook import (
    WebhookIngestBatchResult,
    WebhookIngestIn,
    WebhookProvider,
)
from app.context.schemas import ContextIngestResult
from app.context.service import AssetNotFoundError
from app.db.session import get_session

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


@router.post("/webhook", response_model=WebhookIngestBatchResult)
async def post_webhook(
    body: WebhookIngestIn,
    session: AsyncSession = Depends(get_session),
) -> WebhookIngestBatchResult:
    """
    SCADA / historian adapter.

    Same downstream path as POST /context (facts → review → assessment queue).
    Example::

        curl -s -X POST http://localhost:8000/api/ingest/webhook \\
          -H 'Content-Type: application/json' \\
          -d '{
            "source_system": "scada-historian",
            "asset_name": "Vessel A",
            "readings": [{"metric": "gas_reading", "value": 28.0, "unit": "ppm"}]
          }'
    """
    provider = WebhookProvider(session)
    try:
        results = await provider.ingest(body)
    except AssetNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="Asset not found — pass asset_id or a known asset_name",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return WebhookIngestBatchResult(results=results, count=len(results))


@router.post("/webhook/context", response_model=ContextIngestResult)
async def post_webhook_context(
    body: WebhookIngestIn,
    session: AsyncSession = Depends(get_session),
) -> ContextIngestResult:
    """Single-result convenience wrapper around /webhook."""
    batch = await post_webhook(body, session)
    if not batch.results:
        raise HTTPException(status_code=500, detail="No ingest result")
    return batch.results[0]
