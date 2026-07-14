from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def record_audit(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    event_type: str,
    actor: str | None,
    payload: dict | None = None,
) -> UUID:
    """Insert-only audit entry. Returns the new row id."""
    result = await session.execute(
        text(
            """
            INSERT INTO audit_entries (entity_type, entity_id, event_type, actor, payload)
            VALUES (
                :entity_type,
                CAST(:entity_id AS uuid),
                :event_type,
                :actor,
                CAST(:payload AS jsonb)
            )
            RETURNING id
            """
        ),
        {
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "event_type": event_type,
            "actor": actor,
            "payload": __import__("json").dumps(payload or {}),
        },
    )
    row = result.one()
    return row[0]
