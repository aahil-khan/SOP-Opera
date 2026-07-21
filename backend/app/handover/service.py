"""
Shift handover — custody transfer between panel operators.

A handover moves through `draft → issued → accepted`. The forcing function is
`accept()`: it refuses while any item marked `requires_ack` is still pending, so
taking custody of the plant means having read every hazard the outgoing operator
was holding. That gate, plus the audit trail underneath it, is the entire point
of the feature — a brief nobody has to acknowledge is just a summary.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.auth.schemas import ActorMeOut
from app.core.config import get_settings
from app.handover import repository as repo
from app.handover.composer import compose_carry_forward
from app.handover.narration import narrate
from app.handover.schemas import (
    HandoverGapOut,
    HandoverItemOut,
    HandoverMetricsOut,
    HandoverOut,
)
from app.notifications.service import create_notification
from app.realtime.connection_manager import manager

logger = logging.getLogger(__name__)

_RISK_ORDER = {"blocking": 0, "elevated": 1, "nominal": 2}


class HandoverError(ValueError):
    """A handover action that is not legal in the current state."""


# --- Assembly ---------------------------------------------------------------


async def _resolve_actor(
    session: AsyncSession, *, actor_id: UUID
) -> tuple[str, str] | None:
    """(name, kind) for a polymorphic actor id — users first, then workers."""
    result = await session.execute(
        text("SELECT name FROM users WHERE id = CAST(:id AS uuid)"),
        {"id": str(actor_id)},
    )
    name = result.scalar_one_or_none()
    if name:
        return str(name), "user"
    result = await session.execute(
        text("SELECT name FROM workers WHERE id = CAST(:id AS uuid)"),
        {"id": str(actor_id)},
    )
    name = result.scalar_one_or_none()
    if name:
        return str(name), "worker"
    return None


def _to_item_out(row: dict[str, Any]) -> HandoverItemOut:
    return HandoverItemOut(
        id=row["id"],
        item_type=row["item_type"],
        position=row["position"],
        review_id=row.get("review_id"),
        asset_id=row.get("asset_id"),
        asset_name=row.get("asset_name"),
        task_id=row.get("task_id"),
        title=row["title"],
        detail=row.get("detail"),
        risk_level=row.get("risk_level") or "nominal",
        hazard_dimensions=list(row.get("hazard_dimensions") or []),
        requires_ack=bool(row.get("requires_ack")),
        ack_state=row.get("ack_state") or "pending",
        ack_note=row.get("ack_note"),
        acknowledged_by=row.get("acknowledged_by"),
        acknowledged_by_name=row.get("acknowledged_by_name"),
        acknowledged_at=row.get("acknowledged_at"),
        source=row.get("source") or "auto",
    )


def _viewer_role(handover: dict[str, Any], actor: ActorMeOut | None) -> str:
    if actor is None:
        return "observer"
    if str(handover["incoming_actor_id"]) == str(actor.id):
        return "incoming"
    if str(handover["outgoing_actor_id"]) == str(actor.id):
        return "outgoing"
    return "observer"


async def _assemble(
    session: AsyncSession, *, handover: dict[str, Any], actor: ActorMeOut | None
) -> HandoverOut:
    rows = await repo.fetch_items(session, handover_id=handover["id"])
    items = [_to_item_out(r) for r in rows]
    required = [i for i in items if i.requires_ack]

    # Point the incoming operator at the worst thing they have not yet read; once
    # everything is cleared, at the worst thing on the list.
    pending = [i for i in required if i.ack_state == "pending"]
    candidates = pending or items
    attention = min(
        (i for i in candidates if i.asset_id),
        key=lambda i: (_RISK_ORDER.get(i.risk_level, 3), i.position),
        default=None,
    )

    return HandoverOut(
        id=handover["id"],
        state=handover["state"],
        outgoing_actor_id=handover["outgoing_actor_id"],
        outgoing_actor_name=handover["outgoing_actor_name"],
        incoming_actor_id=handover["incoming_actor_id"],
        incoming_actor_name=handover["incoming_actor_name"],
        window_start=handover["window_start"],
        window_end=handover["window_end"],
        brief=handover.get("brief"),
        narration_mode=handover.get("narration_mode") or "deterministic",
        issued_at=handover.get("issued_at"),
        accepted_at=handover.get("accepted_at"),
        created_at=handover["created_at"],
        items=items,
        required_total=len(required),
        required_cleared=sum(1 for i in required if i.ack_state != "pending"),
        attention_asset_id=attention.asset_id if attention else None,
        viewer_role=_viewer_role(handover, actor),  # type: ignore[arg-type]
    )


# --- Reads ------------------------------------------------------------------


async def get_current(
    session: AsyncSession, *, actor: ActorMeOut | None
) -> HandoverOut | None:
    """The handover in flight, or the most recent one once it is settled."""
    handover = await repo.fetch_active_handover(session)
    if handover is None:
        handover = await repo.fetch_latest_handover(session)
    if handover is None:
        return None
    return await _assemble(session, handover=handover, actor=actor)


async def get_gaps(session: AsyncSession) -> list[HandoverGapOut]:
    return [
        HandoverGapOut(
            handover_id=row["handover_id"],
            item_id=row["item_id"],
            asset_id=row.get("asset_id"),
            asset_name=row.get("asset_name"),
            title=row["title"],
            risk_level=row.get("risk_level") or "nominal",
            incoming_actor_name=row["incoming_actor_name"],
            issued_at=row.get("issued_at"),
            hours_outstanding=float(row.get("hours_outstanding") or 0.0),
        )
        for row in await repo.fetch_gaps(session)
    ]


async def get_metrics(session: AsyncSession) -> HandoverMetricsOut:
    row = await repo.fetch_metrics(session)
    total = int(row.get("required_items_total") or 0)
    cleared = int(row.get("required_items_cleared") or 0)
    median = row.get("median_ack_minutes")
    return HandoverMetricsOut(
        handovers_total=int(row.get("handovers_total") or 0),
        handovers_accepted=int(row.get("handovers_accepted") or 0),
        required_items_total=total,
        required_items_cleared=cleared,
        coverage_pct=round(100.0 * cleared / total, 1) if total else 100.0,
        median_ack_minutes=round(float(median), 1) if median is not None else None,
        unacknowledged_crossings=int(row.get("unacknowledged_crossings") or 0),
    )


# --- Writes -----------------------------------------------------------------


async def open_draft(
    session: AsyncSession,
    *,
    actor: ActorMeOut,
    incoming_actor_id: UUID,
    window_hours: int = 12,
) -> HandoverOut:
    """Compose the carry-forward list the outgoing operator is still holding."""
    if str(incoming_actor_id) == str(actor.id):
        raise HandoverError("A handover needs two different operators.")

    resolved = await _resolve_actor(session, actor_id=incoming_actor_id)
    if resolved is None:
        raise LookupError(f"Unknown actor {incoming_actor_id}")
    incoming_name, incoming_kind = resolved

    # Only one handover may be in flight (`uq_handovers_active`). Retiring the
    # previous one here rather than refusing keeps a stale draft from wedging the
    # feature, and the expired row keeps its unacknowledged items visible in
    # `get_gaps` — an abandoned handover is itself a handover failure.
    await repo.expire_stale_active(session, keep_id=None)

    window_end = datetime.now(timezone.utc)
    window_start = window_end - timedelta(hours=window_hours)
    items = await compose_carry_forward(session, window_hours=window_hours)

    provider_name = get_settings().ai_provider
    brief, mode, _provider, _model = await narrate(
        items, window_hours=window_hours, provider_name=provider_name
    )

    handover_id = await repo.insert_handover(
        session,
        outgoing=(actor.id, actor.name, actor.kind),
        incoming=(incoming_actor_id, incoming_name, incoming_kind),
        window_start=window_start,
        window_end=window_end,
        brief=brief,
        narration_mode=mode,
    )
    await repo.insert_items(session, handover_id=handover_id, items=items)
    await session.commit()

    handover = await repo.fetch_handover(session, handover_id=handover_id)
    assert handover is not None
    return await _assemble(session, handover=handover, actor=actor)


async def add_note(
    session: AsyncSession,
    *,
    handover_id: UUID,
    actor: ActorMeOut,
    title: str,
    detail: str | None,
    requires_ack: bool,
) -> HandoverOut:
    handover = await _require(session, handover_id=handover_id)
    _require_state(handover, {"draft"}, "add a note to")
    _require_party(handover, actor, "outgoing")

    await repo.insert_note(
        session,
        handover_id=handover_id,
        title=title,
        detail=detail,
        requires_ack=requires_ack,
    )
    await session.commit()
    return await _assemble(session, handover=handover, actor=actor)


async def remove_item(
    session: AsyncSession,
    *,
    handover_id: UUID,
    item_id: UUID,
    actor: ActorMeOut,
) -> HandoverOut:
    """Drop an auto-composed item the outgoing operator judges not relevant."""
    handover = await _require(session, handover_id=handover_id)
    _require_state(handover, {"draft"}, "edit")
    _require_party(handover, actor, "outgoing")

    if not await repo.delete_item(session, handover_id=handover_id, item_id=item_id):
        raise LookupError(f"Unknown handover item {item_id}")
    await session.commit()
    return await _assemble(session, handover=handover, actor=actor)


async def issue(
    session: AsyncSession, *, handover_id: UUID, actor: ActorMeOut
) -> HandoverOut:
    handover = await _require(session, handover_id=handover_id)
    _require_state(handover, {"draft"}, "issue")
    _require_party(handover, actor, "outgoing")

    await repo.set_state(
        session, handover_id=handover_id, state="issued", timestamp_column="issued_at"
    )
    items = await repo.fetch_items(session, handover_id=handover_id)
    required = [i for i in items if i.get("requires_ack")]

    await record_audit(
        session,
        entity_type="handover",
        entity_id=handover_id,
        event_type="handover.issued",
        actor=actor.name,
        payload={
            "incoming_actor": handover["incoming_actor_name"],
            "item_count": len(items),
            "required_count": len(required),
            "narration_mode": handover.get("narration_mode"),
        },
    )
    await create_notification(
        session,
        review_id=None,
        event_type="handover.issued",
        summary=(
            f"{actor.name} handed over {len(required)} item"
            f"{'s' if len(required) != 1 else ''} needing your acknowledgement."
        ),
        recipient_ids=[handover["incoming_actor_id"]],
    )
    await session.commit()

    fresh = await _require(session, handover_id=handover_id)
    out = await _assemble(session, handover=fresh, actor=actor)
    await manager.broadcast(
        "handover.issued",
        {
            "handover_id": str(handover_id),
            "outgoing_actor_name": handover["outgoing_actor_name"],
            "incoming_actor_id": str(handover["incoming_actor_id"]),
            "incoming_actor_name": handover["incoming_actor_name"],
            "required_total": out.required_total,
        },
    )
    return out


async def acknowledge_item(
    session: AsyncSession,
    *,
    handover_id: UUID,
    item_id: UUID,
    ack_state: str,
    note: str | None,
    actor: ActorMeOut,
) -> HandoverOut:
    handover = await _require(session, handover_id=handover_id)
    _require_state(handover, {"issued"}, "acknowledge items on")
    _require_party(handover, actor, "incoming")

    row = await repo.acknowledge_item(
        session,
        handover_id=handover_id,
        item_id=item_id,
        ack_state=ack_state,
        note=note,
        actor_id=actor.id,
        actor_name=actor.name,
    )
    if row is None:
        raise LookupError(f"Unknown handover item {item_id}")

    await record_audit(
        session,
        entity_type="handover",
        entity_id=handover_id,
        event_type="handover.item_acknowledged",
        actor=actor.name,
        payload={
            "item_id": str(item_id),
            "item_title": row["title"],
            "ack_state": ack_state,
            "risk_level": row.get("risk_level"),
            "note": note,
        },
    )
    await session.commit()

    out = await _assemble(session, handover=handover, actor=actor)
    await manager.broadcast(
        "handover.item_acknowledged",
        {
            "handover_id": str(handover_id),
            "item_id": str(item_id),
            "ack_state": ack_state,
            "actor_name": actor.name,
            "required_total": out.required_total,
            "required_cleared": out.required_cleared,
        },
    )
    return out


async def accept(
    session: AsyncSession, *, handover_id: UUID, actor: ActorMeOut
) -> HandoverOut:
    """
    Take custody. Refuses while any required item is still pending.

    This is the whole feature: without it a handover is a document nobody has to
    read, which is the failure the platform exists to catch.
    """
    handover = await _require(session, handover_id=handover_id)
    _require_state(handover, {"issued"}, "accept")
    _require_party(handover, actor, "incoming")

    items = await repo.fetch_items(session, handover_id=handover_id)
    outstanding = [
        i for i in items if i.get("requires_ack") and i.get("ack_state") == "pending"
    ]
    if outstanding:
        raise HandoverError(
            f"{len(outstanding)} item{'s' if len(outstanding) != 1 else ''} still "
            "need acknowledgement before you can take custody."
        )

    await repo.set_state(
        session,
        handover_id=handover_id,
        state="accepted",
        timestamp_column="accepted_at",
    )
    await record_audit(
        session,
        entity_type="handover",
        entity_id=handover_id,
        event_type="handover.accepted",
        actor=actor.name,
        payload={
            "outgoing_actor": handover["outgoing_actor_name"],
            "acknowledged_count": sum(1 for i in items if i.get("requires_ack")),
            "queried_count": sum(
                1 for i in items if i.get("ack_state") == "queried"
            ),
        },
    )
    await create_notification(
        session,
        review_id=None,
        event_type="handover.accepted",
        summary=f"{actor.name} accepted the shift handover.",
        recipient_ids=[handover["outgoing_actor_id"]],
    )
    await session.commit()

    fresh = await _require(session, handover_id=handover_id)
    out = await _assemble(session, handover=fresh, actor=actor)
    await manager.broadcast(
        "handover.accepted",
        {
            "handover_id": str(handover_id),
            "incoming_actor_name": actor.name,
            "outgoing_actor_id": str(handover["outgoing_actor_id"]),
        },
    )
    return out


# --- Guards -----------------------------------------------------------------


async def _require(session: AsyncSession, *, handover_id: UUID) -> dict[str, Any]:
    handover = await repo.fetch_handover(session, handover_id=handover_id)
    if handover is None:
        raise LookupError(f"Unknown handover {handover_id}")
    return handover


def _require_state(
    handover: dict[str, Any], allowed: set[str], action: str
) -> None:
    if handover["state"] not in allowed:
        raise HandoverError(
            f"Cannot {action} a handover that is {handover['state']}."
        )


def _require_party(
    handover: dict[str, Any], actor: ActorMeOut, side: str
) -> None:
    if str(handover[f"{side}_actor_id"]) != str(actor.id):
        raise HandoverError(
            f"Only {handover[f'{side}_actor_name']} can do this — "
            f"you are signed in as {actor.name}."
        )
