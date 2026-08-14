"""SQL for the response domain. No business rules — those live in service.py."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _rows(result) -> list[dict[str, Any]]:
    return [dict(r._mapping) for r in result.fetchall()]


# --- Devices -----------------------------------------------------------------


async def devices_in_zones(
    session: AsyncSession, zones: list[str]
) -> list[dict[str, Any]]:
    if not zones:
        return []
    result = await session.execute(
        text(
            """
            SELECT id, asset_id, zone, kind, label, state, default_state,
                   fail_safe_state, reversible, controllable, simulated
            FROM response_devices
            WHERE zone = ANY(:zones) AND controllable
            ORDER BY zone, kind
            """
        ),
        {"zones": zones},
    )
    return _rows(result)


async def list_devices(session: AsyncSession) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT id, asset_id, zone, kind, label, state, default_state,
                   fail_safe_state, reversible, controllable, simulated,
                   updated_at
            FROM response_devices
            ORDER BY zone, kind
            """
        )
    )
    return _rows(result)


async def set_device_state(
    session: AsyncSession, device_id: UUID, state: str
) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            """
            UPDATE response_devices
            SET state = :state, updated_at = now()
            WHERE id = CAST(:id AS uuid)
            RETURNING id, zone, kind, label, state, simulated
            """
        ),
        {"id": str(device_id), "state": state},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def reset_device_states(session: AsyncSession) -> int:
    """
    Return every device to its default state.

    Called by the demo reset: response_devices survives the wipe (it is seeded
    reference data), but leaving a fan running or a gate shut from the previous
    run would make the next demo start mid-incident.
    """
    result = await session.execute(
        text(
            """
            UPDATE response_devices
            SET state = default_state, updated_at = now()
            WHERE state IS DISTINCT FROM default_state
            """
        )
    )
    return result.rowcount or 0


# --- Actions -----------------------------------------------------------------


async def insert_action(
    session: AsyncSession,
    *,
    review_id: UUID,
    asset_id: UUID | None,
    tier: int,
    action_kind: str,
    device_id: UUID | None,
    target_ref: str | None,
    status: str,
    envelope: dict,
    refusal_reason: str | None,
    actor: str,
    arm_window_seconds: int,
) -> dict[str, Any] | None:
    """
    Insert one action row.

    Returns None when the Tier 0 partial unique index rejects a duplicate — that
    is the idempotency guarantee, enforced by the database rather than by a
    read-then-write race in Python.
    """
    now = datetime.now(timezone.utc)
    armed = status == "armed"
    result = await session.execute(
        text(
            """
            INSERT INTO response_actions (
                review_id, asset_id, tier, action_kind, device_id, target_ref,
                status, envelope, refusal_reason, actor,
                armed_at, execute_after, executed_at
            )
            VALUES (
                CAST(:review_id AS uuid),
                CAST(:asset_id AS uuid),
                :tier,
                :action_kind,
                CAST(:device_id AS uuid),
                :target_ref,
                :status,
                CAST(:envelope AS jsonb),
                :refusal_reason,
                :actor,
                :armed_at,
                :execute_after,
                :executed_at
            )
            ON CONFLICT DO NOTHING
            RETURNING id, review_id, asset_id, tier, action_kind, device_id,
                      target_ref, status, envelope, refusal_reason, actor,
                      armed_at, execute_after, executed_at, created_at
            """
        ),
        {
            "review_id": str(review_id),
            "asset_id": str(asset_id) if asset_id else None,
            "tier": tier,
            "action_kind": action_kind,
            "device_id": str(device_id) if device_id else None,
            "target_ref": target_ref,
            "status": status,
            "envelope": json.dumps(envelope),
            "refusal_reason": refusal_reason,
            "actor": actor,
            "armed_at": now if armed else None,
            "execute_after": (
                now + timedelta(seconds=arm_window_seconds) if armed else None
            ),
            # Tier 0 and other non-arming statuses are effective immediately.
            "executed_at": now if status == "active" else None,
        },
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def supersede_refusals(session: AsyncSession, review_id: UUID) -> int:
    """
    Retire this review's previous refusals before re-evaluating.

    A refusal records "we considered this and declined it, on this verdict". A
    re-assessment produces a fresh verdict, so the old refusals are stale — and
    they would otherwise occupy the live-per-kind unique index and block the new
    ones from being recorded. Armed and active rows are left alone: those are
    live commitments, not stale opinions.
    """
    result = await session.execute(
        text(
            """
            UPDATE response_actions
            SET status = 'superseded'
            WHERE review_id = CAST(:review_id AS uuid)
              AND status = 'refused'
            """
        ),
        {"review_id": str(review_id)},
    )
    return result.rowcount or 0


async def get_action(
    session: AsyncSession, action_id: UUID
) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            """
            SELECT a.*, d.zone AS device_zone, d.kind AS device_kind,
                   d.label AS device_label, d.fail_safe_state, d.default_state
            FROM response_actions a
            LEFT JOIN response_devices d ON d.id = a.device_id
            WHERE a.id = CAST(:id AS uuid)
            """
        ),
        {"id": str(action_id)},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def due_armed_actions(session: AsyncSession) -> list[dict[str, Any]]:
    """
    Armed actions whose window has elapsed.

    `FOR UPDATE SKIP LOCKED` so two dispatcher ticks (or two processes) cannot
    execute the same action twice — the same discipline the assessment queue
    uses.
    """
    result = await session.execute(
        text(
            """
            SELECT id, review_id, asset_id, action_kind, device_id, tier
            FROM response_actions
            WHERE status = 'armed' AND execute_after <= now()
            ORDER BY execute_after
            FOR UPDATE SKIP LOCKED
            """
        )
    )
    return _rows(result)


async def mark_executed(session: AsyncSession, action_id: UUID) -> None:
    await session.execute(
        text(
            """
            UPDATE response_actions
            SET status = 'active', executed_at = now()
            WHERE id = CAST(:id AS uuid) AND status = 'armed'
            """
        ),
        {"id": str(action_id)},
    )


async def mark_aborted(
    session: AsyncSession, action_id: UUID, *, actor: str
) -> bool:
    """Abort during the arming window. False if it already executed."""
    result = await session.execute(
        text(
            """
            UPDATE response_actions
            SET status = 'aborted', aborted_at = now(), aborted_by = :actor
            WHERE id = CAST(:id AS uuid) AND status = 'armed'
            """
        ),
        {"id": str(action_id), "actor": actor},
    )
    return bool(result.rowcount)


async def mark_revoked(
    session: AsyncSession, action_id: UUID, *, actor: str, reason: str | None
) -> bool:
    result = await session.execute(
        text(
            """
            UPDATE response_actions
            SET status = 'revoked', revoked_at = now(),
                revoked_by = :actor, revoke_reason = :reason
            WHERE id = CAST(:id AS uuid) AND status IN ('armed', 'active')
            """
        ),
        {"id": str(action_id), "actor": actor, "reason": reason},
    )
    return bool(result.rowcount)


_ACTION_SELECT = """
    SELECT a.id, a.review_id, a.asset_id, a.tier, a.action_kind, a.device_id,
           a.target_ref, a.status, a.envelope, a.refusal_reason, a.actor,
           a.armed_at, a.execute_after, a.executed_at, a.aborted_at,
           a.revoked_at, a.revoked_by, a.revoke_reason, a.created_at,
           d.label AS device_label, d.zone AS device_zone, d.kind AS device_kind,
           d.state AS device_state, d.simulated AS device_simulated,
           ast.name AS asset_name
    FROM response_actions a
    LEFT JOIN response_devices d ON d.id = a.device_id
    LEFT JOIN assets ast ON ast.id = a.asset_id
"""


async def list_active_actions(session: AsyncSession) -> list[dict[str, Any]]:
    """
    Rail contents, plant-wide.

    Includes `refused` rows deliberately: a Tier 3 refusal is evidence the
    envelope is a gate, so it is shown rather than hidden.
    """
    result = await session.execute(
        text(
            _ACTION_SELECT
            + """
            WHERE a.status IN ('armed', 'active', 'refused')
            ORDER BY a.tier DESC, a.created_at DESC
            """
        )
    )
    return _rows(result)


async def list_actions_for_review(
    session: AsyncSession, review_id: UUID
) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            _ACTION_SELECT
            + """
            WHERE a.review_id = CAST(:review_id AS uuid)
            ORDER BY a.tier, a.created_at
            """
        ),
        {"review_id": str(review_id)},
    )
    return _rows(result)


# --- Contacts and pages ------------------------------------------------------


async def contacts_for_zones(
    session: AsyncSession, zones: list[str]
) -> list[dict[str, Any]]:
    if not zones:
        return []
    result = await session.execute(
        text(
            """
            SELECT id, role, zone, contact, escalation_order, simulated
            FROM response_contacts
            WHERE zone = ANY(:zones)
            ORDER BY escalation_order, zone
            """
        ),
        {"zones": zones},
    )
    return _rows(result)


async def insert_page(
    session: AsyncSession,
    *,
    action_id: UUID,
    review_id: UUID,
    contact: dict[str, Any],
    channel: str,
    escalated_from_id: UUID | None = None,
) -> dict[str, Any]:
    result = await session.execute(
        text(
            """
            INSERT INTO response_pages (
                action_id, review_id, contact_id, role, zone, channel,
                escalation_order, status, escalated_from_id
            )
            VALUES (
                CAST(:action_id AS uuid),
                CAST(:review_id AS uuid),
                CAST(:contact_id AS uuid),
                :role, :zone, :channel, :escalation_order,
                'dispatched',
                CAST(:escalated_from_id AS uuid)
            )
            RETURNING id, action_id, review_id, contact_id, role, zone, channel,
                      escalation_order, status, dispatched_at, escalated_from_id
            """
        ),
        {
            "action_id": str(action_id),
            "review_id": str(review_id),
            "contact_id": str(contact["id"]),
            "role": contact["role"],
            "zone": contact["zone"],
            "channel": channel,
            "escalation_order": contact["escalation_order"],
            "escalated_from_id": (
                str(escalated_from_id) if escalated_from_id else None
            ),
        },
    )
    return dict(result.one()._mapping)


async def acknowledge_page(
    session: AsyncSession, page_id: UUID, *, actor: str
) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            """
            UPDATE response_pages
            SET status = 'acknowledged',
                acknowledged_at = now(),
                acknowledged_by = :actor
            WHERE id = CAST(:id AS uuid) AND status = 'dispatched'
            RETURNING id, action_id, review_id, role, zone, channel,
                      escalation_order, acknowledged_at, acknowledged_by
            """
        ),
        {"id": str(page_id), "actor": actor},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def unacknowledged_pages(
    session: AsyncSession, *, older_than_seconds: int
) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT id, action_id, review_id, contact_id, role, zone, channel,
                   escalation_order, dispatched_at
            FROM response_pages
            WHERE status = 'dispatched'
              AND dispatched_at < now() - make_interval(secs => :secs)
            ORDER BY dispatched_at
            FOR UPDATE SKIP LOCKED
            """
        ),
        {"secs": older_than_seconds},
    )
    return _rows(result)


async def mark_page_escalated(session: AsyncSession, page_id: UUID) -> None:
    await session.execute(
        text(
            """
            UPDATE response_pages
            SET status = 'escalated'
            WHERE id = CAST(:id AS uuid) AND status = 'dispatched'
            """
        ),
        {"id": str(page_id)},
    )


async def mark_page_exhausted(session: AsyncSession, page_id: UUID) -> None:
    """No further contact in the chain — recorded rather than failing silently."""
    await session.execute(
        text(
            """
            UPDATE response_pages
            SET status = 'exhausted'
            WHERE id = CAST(:id AS uuid) AND status = 'dispatched'
            """
        ),
        {"id": str(page_id)},
    )


async def pages_for_actions(
    session: AsyncSession, action_ids: list[UUID]
) -> list[dict[str, Any]]:
    if not action_ids:
        return []
    result = await session.execute(
        text(
            """
            SELECT id, action_id, review_id, role, zone, channel,
                   escalation_order, status, dispatched_at, acknowledged_at,
                   acknowledged_by, escalated_from_id
            FROM response_pages
            WHERE action_id = ANY(CAST(:ids AS uuid[]))
            ORDER BY escalation_order, dispatched_at
            """
        ),
        {"ids": [str(a) for a in action_ids]},
    )
    return _rows(result)


async def dispatched_pages_for_action(
    session: AsyncSession, action_id: UUID
) -> list[dict[str, Any]]:
    """Pages still outstanding for an action — the stand-down recipient list."""
    result = await session.execute(
        text(
            """
            SELECT id, role, zone, channel, escalation_order
            FROM response_pages
            WHERE action_id = CAST(:id AS uuid)
              AND status IN ('dispatched', 'acknowledged')
            ORDER BY escalation_order
            """
        ),
        {"id": str(action_id)},
    )
    return _rows(result)
