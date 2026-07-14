from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.context.derived_facts import compute_and_persist
from app.context.schemas import ContextIn, ContextIngestResult
from app.reviews.service import handle_context_change
from shared.python.schemas import Context


class AssetNotFoundError(Exception):
    def __init__(self, asset_id: UUID) -> None:
        self.asset_id = asset_id
        super().__init__(f"Asset {asset_id} not found")


async def asset_exists(session: AsyncSession, asset_id: UUID) -> bool:
    result = await session.execute(
        text("SELECT 1 FROM assets WHERE id = CAST(:id AS uuid)"),
        {"id": str(asset_id)},
    )
    return result.first() is not None


async def ingest_context(
    session: AsyncSession, body: ContextIn
) -> ContextIngestResult:
    if not await asset_exists(session, body.asset_id):
        raise AssetNotFoundError(body.asset_id)

    now = datetime.now(timezone.utc)
    valid_from = body.valid_from or now
    valid_until = body.valid_until or (now + timedelta(hours=4))

    result = await session.execute(
        text(
            """
            INSERT INTO context_entries (
                asset_id, category, payload, provider,
                valid_from, valid_until, confidence
            )
            VALUES (
                CAST(:asset_id AS uuid),
                :category,
                CAST(:payload AS jsonb),
                :provider,
                :valid_from,
                :valid_until,
                :confidence
            )
            RETURNING id, asset_id, category, payload, provider,
                      valid_from, valid_until, confidence
            """
        ),
        {
            "asset_id": str(body.asset_id),
            "category": body.category,
            "payload": json.dumps(body.payload),
            "provider": body.provider,
            "valid_from": valid_from,
            "valid_until": valid_until,
            "confidence": body.confidence,
        },
    )
    row = result.one()
    m = row._mapping
    payload = m["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)

    context = Context(
        id=m["id"],
        asset_id=m["asset_id"],
        category=m["category"],
        payload=dict(payload),
        provider=m["provider"],
        valid_from=m["valid_from"],
        valid_until=m["valid_until"],
        confidence=float(m["confidence"]),
    )

    facts, changed = await compute_and_persist(
        session, body.asset_id, now=now
    )
    review = await handle_context_change(
        session, body.asset_id, changed, facts, actor=f"provider:{body.provider}"
    )
    # handle_context_change / create_review already commit; ensure context persist committed
    await session.commit()

    return ContextIngestResult(
        context=context, derived_facts=facts, review=review
    )


async def list_asset_context(
    session: AsyncSession, asset_id: UUID, *, limit: int = 50
) -> list[Context]:
    if not await asset_exists(session, asset_id):
        raise AssetNotFoundError(asset_id)
    result = await session.execute(
        text(
            """
            SELECT id, asset_id, category, payload, provider,
                   valid_from, valid_until, confidence
            FROM context_entries
            WHERE asset_id = CAST(:asset_id AS uuid)
            ORDER BY valid_from DESC
            LIMIT :limit
            """
        ),
        {"asset_id": str(asset_id), "limit": limit},
    )
    out: list[Context] = []
    for row in result.fetchall():
        m = row._mapping
        payload = m["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        out.append(
            Context(
                id=m["id"],
                asset_id=m["asset_id"],
                category=m["category"],
                payload=dict(payload),
                provider=m["provider"],
                valid_from=m["valid_from"],
                valid_until=m["valid_until"],
                confidence=float(m["confidence"]),
            )
        )
    return out
