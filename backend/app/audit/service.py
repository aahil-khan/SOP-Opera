from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.chain import (
    AUDIT_CHAIN_LOCK_KEY,
    GENESIS_HASH,
    ChainVerification,
    compute_entry_hash,
    verify_rows,
)


async def record_audit(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    event_type: str,
    actor: str | None,
    payload: dict | None = None,
) -> UUID:
    """
    Append an audit entry, linked by hash to the previous one.

    Insert-only: nothing in the codebase updates or deletes an audit row, and the
    chain makes it detectable if anything outside the codebase does. See
    `app/audit/chain.py`.
    """
    # Serialize appends so two concurrent writers cannot read the same chain tail
    # and fork it. Transaction-scoped — released on commit or rollback.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": AUDIT_CHAIN_LOCK_KEY}
    )

    tail = await session.execute(
        text(
            """
            SELECT entry_hash
            FROM audit_entries
            WHERE entry_hash IS NOT NULL
            ORDER BY seq DESC
            LIMIT 1
            """
        )
    )
    prev_hash = tail.scalar_one_or_none() or GENESIS_HASH

    recorded_at = datetime.now(timezone.utc)
    payload = payload or {}
    entry_hash = compute_entry_hash(
        prev_hash=prev_hash,
        entity_type=entity_type,
        entity_id=entity_id,
        event_type=event_type,
        actor=actor,
        payload=payload,
        recorded_at=recorded_at,
    )

    result = await session.execute(
        text(
            """
            INSERT INTO audit_entries (
                entity_type, entity_id, event_type, actor, payload,
                recorded_at, prev_hash, entry_hash
            )
            VALUES (
                :entity_type,
                CAST(:entity_id AS uuid),
                :event_type,
                :actor,
                CAST(:payload AS jsonb),
                :recorded_at,
                :prev_hash,
                :entry_hash
            )
            RETURNING id
            """
        ),
        {
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "event_type": event_type,
            "actor": actor,
            "payload": json.dumps(payload),
            "recorded_at": recorded_at,
            "prev_hash": prev_hash,
            "entry_hash": entry_hash,
        },
    )
    row = result.one()
    return row[0]


async def verify_audit_chain(
    session: AsyncSession,
    *,
    entity_id: UUID | None = None,
) -> ChainVerification:
    """
    Recompute the whole chain and report any break.

    `entity_id` filters which breaks are *reported*, but verification always runs
    over the full chain — a subset of rows cannot be verified in isolation,
    because each hash depends on entries that may belong to other entities.
    """
    result = await session.execute(
        text(
            """
            SELECT id, seq, entity_type, entity_id, event_type, actor,
                   payload, recorded_at, prev_hash, entry_hash
            FROM audit_entries
            ORDER BY seq ASC
            """
        )
    )
    rows = [dict(r._mapping) for r in result.fetchall()]
    verification = verify_rows(rows)

    if entity_id is None:
        return verification

    wanted = {str(r["id"]) for r in rows if str(r.get("entity_id")) == str(entity_id)}
    return ChainVerification(
        entries_checked=verification.entries_checked,
        unhashed_entries=verification.unhashed_entries,
        breaks=tuple(b for b in verification.breaks if b.entry_id in wanted),
    )
