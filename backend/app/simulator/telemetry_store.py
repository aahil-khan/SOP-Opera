"""Quiet soft-telemetry ring — persists ambient WS samples for UI hydration.

Unlike context ingest, writes here never compute derived facts or open reviews.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _parse_ts(raw: Any) -> datetime | None:
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    if isinstance(raw, str) and raw:
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


async def persist_samples(
    session: AsyncSession,
    samples: list[dict[str, Any]],
    *,
    keep_per_asset: int = 40,
) -> int:
    """Insert soft samples and prune older rows per asset. Returns insert count."""
    if not samples:
        return 0

    inserted = 0
    asset_ids: set[str] = set()
    for sample in samples:
        asset_id = sample.get("asset_id")
        if not asset_id:
            continue
        ts = _parse_ts(sample.get("ts")) or datetime.now(timezone.utc)
        await session.execute(
            text(
                """
                INSERT INTO telemetry_samples (
                    asset_id, asset_name, source, category, payload, ts, mode
                )
                VALUES (
                    CAST(:asset_id AS uuid),
                    :asset_name,
                    :source,
                    :category,
                    CAST(:payload AS jsonb),
                    :ts,
                    :mode
                )
                """
            ),
            {
                "asset_id": str(asset_id),
                "asset_name": str(sample.get("asset_name") or ""),
                "source": str(sample.get("source") or "scada"),
                "category": str(sample.get("category") or "sensor"),
                "payload": json.dumps(sample.get("payload") or {}),
                "ts": ts,
                "mode": str(sample.get("mode") or "ambient"),
            },
        )
        asset_ids.add(str(asset_id))
        inserted += 1

    keep = max(1, int(keep_per_asset))
    for asset_id in asset_ids:
        await session.execute(
            text(
                """
                DELETE FROM telemetry_samples
                WHERE asset_id = CAST(:asset_id AS uuid)
                  AND id NOT IN (
                    SELECT id FROM telemetry_samples
                    WHERE asset_id = CAST(:asset_id AS uuid)
                    ORDER BY ts DESC
                    LIMIT :keep
                  )
                """
            ),
            {"asset_id": asset_id, "keep": keep},
        )

    await session.commit()
    return inserted


async def list_recent_samples(
    session: AsyncSession,
    *,
    per_asset: int = 30,
    asset_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Return soft samples oldest→newest for chart ring fill."""
    limit = max(1, int(per_asset))
    if asset_id is not None:
        result = await session.execute(
            text(
                """
                SELECT asset_id, asset_name, source, category, payload, ts, mode
                FROM (
                    SELECT asset_id, asset_name, source, category, payload, ts, mode
                    FROM telemetry_samples
                    WHERE asset_id = CAST(:asset_id AS uuid)
                    ORDER BY ts DESC
                    LIMIT :limit
                ) recent
                ORDER BY ts ASC
                """
            ),
            {"asset_id": str(asset_id), "limit": limit},
        )
    else:
        result = await session.execute(
            text(
                """
                SELECT asset_id, asset_name, source, category, payload, ts, mode
                FROM (
                    SELECT
                        asset_id, asset_name, source, category, payload, ts, mode,
                        ROW_NUMBER() OVER (
                            PARTITION BY asset_id ORDER BY ts DESC
                        ) AS rn
                    FROM telemetry_samples
                ) ranked
                WHERE rn <= :limit
                ORDER BY asset_id, ts ASC
                """
            ),
            {"limit": limit},
        )

    out: list[dict[str, Any]] = []
    for row in result.fetchall():
        m = row._mapping
        payload = m["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        ts = m["ts"]
        out.append(
            {
                "source": m["source"],
                "asset_id": str(m["asset_id"]),
                "asset_name": m["asset_name"] or None,
                "category": m["category"],
                "payload": dict(payload) if payload else {},
                "ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                "mode": m["mode"] or "ambient",
            }
        )
    return out
