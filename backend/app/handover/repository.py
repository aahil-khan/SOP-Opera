"""SQL for handovers. Raw `text()` against asyncpg, like every other domain."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

ACTIVE_STATES = ("draft", "issued")


async def fetch_handover(
    session: AsyncSession, *, handover_id: UUID
) -> dict[str, Any] | None:
    result = await session.execute(
        text("SELECT * FROM handovers WHERE id = CAST(:id AS uuid)"),
        {"id": str(handover_id)},
    )
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def fetch_active_handover(session: AsyncSession) -> dict[str, Any] | None:
    """The one handover in flight, if any — `uq_handovers_active` bounds this to 1."""
    result = await session.execute(
        text(
            """
            SELECT * FROM handovers
            WHERE state IN ('draft', 'issued')
            ORDER BY created_at DESC
            LIMIT 1
            """
        )
    )
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def fetch_latest_handover(session: AsyncSession) -> dict[str, Any] | None:
    result = await session.execute(
        text("SELECT * FROM handovers ORDER BY created_at DESC LIMIT 1")
    )
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def fetch_items(
    session: AsyncSession, *, handover_id: UUID
) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT i.*, a.name AS asset_name
            FROM handover_items i
            LEFT JOIN assets a ON a.id = i.asset_id
            WHERE i.handover_id = CAST(:hid AS uuid)
            ORDER BY i.position, i.created_at
            """
        ),
        {"hid": str(handover_id)},
    )
    return [dict(row._mapping) for row in result.fetchall()]


async def insert_handover(
    session: AsyncSession,
    *,
    outgoing: tuple[UUID, str, str],
    incoming: tuple[UUID, str, str],
    window_start: datetime,
    window_end: datetime,
    brief: str,
    narration_mode: str,
) -> UUID:
    result = await session.execute(
        text(
            """
            INSERT INTO handovers (
                outgoing_actor_id, outgoing_actor_name, outgoing_actor_kind,
                incoming_actor_id, incoming_actor_name, incoming_actor_kind,
                state, window_start, window_end, brief, narration_mode
            ) VALUES (
                CAST(:oid AS uuid), :oname, :okind,
                CAST(:iid AS uuid), :iname, :ikind,
                'draft', :wstart, :wend, :brief, :mode
            )
            RETURNING id
            """
        ),
        {
            "oid": str(outgoing[0]),
            "oname": outgoing[1],
            "okind": outgoing[2],
            "iid": str(incoming[0]),
            "iname": incoming[1],
            "ikind": incoming[2],
            "wstart": window_start,
            "wend": window_end,
            "brief": brief,
            "mode": narration_mode,
        },
    )
    return result.scalar_one()


async def insert_items(
    session: AsyncSession, *, handover_id: UUID, items: list[dict[str, Any]]
) -> None:
    for item in items:
        await session.execute(
            text(
                """
                INSERT INTO handover_items (
                    handover_id, position, item_type, review_id, asset_id, task_id,
                    title, detail, risk_level, hazard_dimensions, requires_ack, source
                ) VALUES (
                    CAST(:hid AS uuid), :position, :item_type,
                    CAST(:review_id AS uuid), CAST(:asset_id AS uuid),
                    CAST(:task_id AS uuid),
                    :title, :detail, :risk_level, :dims, :requires_ack, :source
                )
                """
            ),
            {
                "hid": str(handover_id),
                "position": item.get("position", 0),
                "item_type": item["item_type"],
                "review_id": str(item["review_id"]) if item.get("review_id") else None,
                "asset_id": str(item["asset_id"]) if item.get("asset_id") else None,
                "task_id": str(item["task_id"]) if item.get("task_id") else None,
                "title": item["title"],
                "detail": item.get("detail"),
                "risk_level": item.get("risk_level", "nominal"),
                "dims": list(item.get("hazard_dimensions") or []),
                "requires_ack": bool(item.get("requires_ack")),
                "source": item.get("source", "auto"),
            },
        )


async def insert_note(
    session: AsyncSession,
    *,
    handover_id: UUID,
    title: str,
    detail: str | None,
    requires_ack: bool,
) -> UUID:
    result = await session.execute(
        text(
            """
            INSERT INTO handover_items (
                handover_id, position, item_type, title, detail,
                risk_level, requires_ack, source
            )
            SELECT
                CAST(:hid AS uuid),
                COALESCE(MAX(position), -1) + 1,
                'note', :title, :detail, 'nominal', :requires_ack, 'manual'
            FROM handover_items WHERE handover_id = CAST(:hid AS uuid)
            RETURNING id
            """
        ),
        {
            "hid": str(handover_id),
            "title": title,
            "detail": detail,
            "requires_ack": requires_ack,
        },
    )
    return result.scalar_one()


async def delete_item(
    session: AsyncSession, *, handover_id: UUID, item_id: UUID
) -> bool:
    result = await session.execute(
        text(
            """
            DELETE FROM handover_items
            WHERE id = CAST(:iid AS uuid) AND handover_id = CAST(:hid AS uuid)
            RETURNING id
            """
        ),
        {"iid": str(item_id), "hid": str(handover_id)},
    )
    return result.fetchone() is not None


async def set_state(
    session: AsyncSession,
    *,
    handover_id: UUID,
    state: str,
    timestamp_column: str | None = None,
) -> None:
    # `timestamp_column` is chosen from a fixed set by the service, never user input.
    assert timestamp_column in (None, "issued_at", "accepted_at")
    stamp = f", {timestamp_column} = :now" if timestamp_column else ""
    await session.execute(
        text(f"UPDATE handovers SET state = :state{stamp} WHERE id = CAST(:id AS uuid)"),
        {
            "state": state,
            "id": str(handover_id),
            "now": datetime.now(timezone.utc),
        },
    )


async def expire_stale_active(session: AsyncSession, *, keep_id: UUID | None) -> int:
    """Retire any other in-flight handover so the active-uniqueness index holds."""
    # asyncpg cannot infer the type of a bare NULL bind, so the parameter is cast
    # to uuid before the NULL check rather than compared raw.
    result = await session.execute(
        text(
            """
            UPDATE handovers
            SET state = 'expired'
            WHERE state IN ('draft', 'issued')
              AND (CAST(:keep AS uuid) IS NULL OR id <> CAST(:keep AS uuid))
            RETURNING id
            """
        ),
        {"keep": str(keep_id) if keep_id else None},
    )
    return len(result.fetchall())


async def acknowledge_item(
    session: AsyncSession,
    *,
    handover_id: UUID,
    item_id: UUID,
    ack_state: str,
    note: str | None,
    actor_id: UUID,
    actor_name: str,
) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            """
            UPDATE handover_items
            SET ack_state = :ack_state,
                ack_note = :note,
                acknowledged_by = CAST(:actor_id AS uuid),
                acknowledged_by_name = :actor_name,
                acknowledged_at = :now
            WHERE id = CAST(:iid AS uuid) AND handover_id = CAST(:hid AS uuid)
            RETURNING *
            """
        ),
        {
            "ack_state": ack_state,
            "note": note,
            "actor_id": str(actor_id),
            "actor_name": actor_name,
            "now": datetime.now(timezone.utc),
            "iid": str(item_id),
            "hid": str(handover_id),
        },
    )
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def fetch_unacknowledged_for_asset(
    session: AsyncSession, *, asset_id: UUID
) -> list[dict[str, Any]]:
    """
    High-risk items on this asset that an issued handover never got acknowledged.

    Only `issued` handovers count: a draft has not been handed to anyone yet, so
    nobody has failed to acknowledge it, and an accepted one cleared its
    requirements by construction.
    """
    result = await session.execute(
        text(
            """
            SELECT i.id, i.title, i.detail, i.risk_level, i.item_type,
                   h.id AS handover_id, h.issued_at, h.incoming_actor_name,
                   h.outgoing_actor_name
            FROM handover_items i
            JOIN handovers h ON h.id = i.handover_id
            WHERE i.asset_id = CAST(:aid AS uuid)
              AND i.requires_ack
              AND i.ack_state = 'pending'
              AND h.state = 'issued'
            ORDER BY h.issued_at DESC NULLS LAST, i.position
            """
        ),
        {"aid": str(asset_id)},
    )
    return [dict(row._mapping) for row in result.fetchall()]


async def fetch_gaps(session: AsyncSession) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT i.id AS item_id, i.title, i.risk_level, i.asset_id,
                   a.name AS asset_name,
                   h.id AS handover_id, h.issued_at, h.incoming_actor_name,
                   EXTRACT(EPOCH FROM (now() - h.issued_at)) / 3600.0
                       AS hours_outstanding
            FROM handover_items i
            JOIN handovers h ON h.id = i.handover_id
            LEFT JOIN assets a ON a.id = i.asset_id
            WHERE i.requires_ack
              AND i.ack_state = 'pending'
              AND h.state IN ('issued', 'expired')
              AND h.issued_at IS NOT NULL
            ORDER BY h.issued_at
            """
        )
    )
    return [dict(row._mapping) for row in result.fetchall()]


async def fetch_metrics(session: AsyncSession) -> dict[str, Any]:
    """
    Operational measures of the handover process itself.

    Deliberately computed here and not in `eval/` — these describe how well the
    humans are clearing carried hazards, and must not become a detector input
    without a ground-truth criterion, or the compound-vs-single-sensor numbers
    become circular.
    """
    result = await session.execute(
        text(
            """
            WITH issued AS (
                SELECT * FROM handovers WHERE issued_at IS NOT NULL
            ), required AS (
                SELECT i.*, h.issued_at
                FROM handover_items i
                JOIN issued h ON h.id = i.handover_id
                WHERE i.requires_ack
            )
            SELECT
                (SELECT COUNT(*) FROM issued)::int AS handovers_total,
                (SELECT COUNT(*) FROM issued WHERE state = 'accepted')::int
                    AS handovers_accepted,
                (SELECT COUNT(*) FROM required)::int AS required_items_total,
                (SELECT COUNT(*) FROM required WHERE ack_state <> 'pending')::int
                    AS required_items_cleared,
                (SELECT COUNT(*) FROM required
                  WHERE ack_state = 'pending'
                    AND handover_id IN (
                        SELECT id FROM issued WHERE state IN ('issued', 'expired')
                    ))::int AS unacknowledged_crossings,
                (SELECT percentile_cont(0.5) WITHIN GROUP (
                        ORDER BY EXTRACT(EPOCH FROM (acknowledged_at - issued_at)) / 60.0
                    )
                   FROM required
                  WHERE acknowledged_at IS NOT NULL) AS median_ack_minutes
            """
        )
    )
    row = result.fetchone()
    return dict(row._mapping) if row else {}
