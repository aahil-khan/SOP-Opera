"""
The tier engine — turns a risk verdict into bounded automatic actions.

Reads the verdict, never re-derives it: `classify()` in `app/risk/policy.py` is
the only place facts become a verdict, and this module consumes its output.

## Tiers

| Tier | Trigger                | Intent            |
| ---- | ---------------------- | ----------------- |
| 0    | any derived fact       | preserve evidence |
| 1    | verdict `elevated`     | warn              |
| 2    | verdict `blocking`     | protect           |
| 3    | never                  | refused, visibly  |

Tiers are cumulative: a blocking verdict fires 0, 1 and 2. Tier 3 actions are
evaluated and recorded as refusals so the boundary is visible in the product
rather than merely absent from it.

## What this module must never do

It must not write `context_entries`. Response state is a separate axis from the
fact stream; if an action fed back into the facts, the orchestrator could
suppress the hazard that triggered it. See the W1 header in `db/schema.sql` and
`tests/test_response_independence.py`.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.core.config import get_settings
from app.graph.kg import get_plant_graph, neighbors_within_radius
from app.realtime.connection_manager import manager
from app.response import repository as repo
from app.response.envelope import (
    ACTION_REGISTRY,
    ActionSpec,
    Verdict,
    actions_for_tier,
    envelope_payload,
    may_execute_autonomously,
)

logger = logging.getLogger(__name__)

ORCHESTRATOR_ACTOR = "response-orchestrator"

# Which channel each escalation step uses. Escalating changes the medium as well
# as the recipient — a radio call after an unanswered SMS is how a real control
# room widens the net rather than repeating itself.
_CHANNEL_BY_ORDER = {1: "sms", 2: "radio"}
_DEFAULT_CHANNEL = "pa"


def channel_for_order(order: int) -> str:
    return _CHANNEL_BY_ORDER.get(order, _DEFAULT_CHANNEL)


# --- Blast radius ------------------------------------------------------------


async def affected_zones(
    session: AsyncSession, asset_id: UUID
) -> tuple[str | None, list[str]]:
    """
    The zone set an incident on `asset_id` is allowed to act within.

    The focus asset's own zone plus the zones of its spatial neighbours, so a
    hazard can drive ventilation in an adjacent bay it actually threatens — but
    never plant-wide. This is what clause 3 of the envelope is checked against.
    """
    result = await session.execute(
        text("SELECT zone FROM assets WHERE id = CAST(:id AS uuid)"),
        {"id": str(asset_id)},
    )
    row = result.first()
    if row is None:
        return None, []
    focus_zone = row._mapping["zone"]

    zones = {focus_zone}
    try:
        graph = get_plant_graph()
        for nbr in neighbors_within_radius(graph, str(asset_id)):
            if nbr.get("zone"):
                zones.add(str(nbr["zone"]))
    except Exception:  # pragma: no cover - graph is best-effort here
        # A missing floor plan must not stop the response; it only narrows the
        # radius to the focus zone, which is the conservative direction.
        logger.warning("spatial neighbours unavailable; using focus zone only")

    return focus_zone, sorted(zones)


# --- Evaluating a verdict ----------------------------------------------------


def tiers_for(risk_level: str, has_facts: bool) -> list[int]:
    """Cumulative tiers triggered by a verdict."""
    tiers: list[int] = []
    if has_facts:
        tiers.append(0)
    if risk_level in ("elevated", "blocking"):
        tiers.append(1)
    if risk_level == "blocking":
        tiers.append(2)
    return tiers


async def evaluate_and_arm(
    session: AsyncSession,
    *,
    review_id: UUID,
    asset_id: UUID,
    risk_level: str,
    fact_types: list[str],
    actor: str = ORCHESTRATOR_ACTOR,
) -> list[dict[str, Any]]:
    """
    Evaluate every candidate action for this verdict and arm the permitted ones.

    Does not commit — the caller owns the transaction, so the actions and the
    assessment that produced them land together or not at all.
    """
    settings = get_settings()
    tiers = tiers_for(risk_level, has_facts=bool(fact_types))
    if not tiers:
        return []

    focus_zone, zones = await affected_zones(session, asset_id)
    if focus_zone is None:
        logger.warning("asset %s not found; skipping response", asset_id)
        return []

    devices = await repo.devices_in_zones(session, zones)
    by_kind: dict[str, dict[str, Any]] = {}
    for d in devices:
        # Prefer a device in the focus zone over one in a neighbouring zone.
        existing = by_kind.get(d["kind"])
        if existing is None or (
            existing["zone"] != focus_zone and d["zone"] == focus_zone
        ):
            by_kind[d["kind"]] = d

    zone_set = frozenset(zones)
    created: list[dict[str, Any]] = []

    # Previous refusals reflect a previous verdict. Retire them so this pass can
    # record its own; live armed/active rows are untouched and will simply not be
    # duplicated (uq_response_actions_live_per_kind + ON CONFLICT DO NOTHING).
    await repo.supersede_refusals(session, review_id)

    # Tier 3 is always evaluated alongside the triggered tiers so the refusal is
    # on the record for this incident, not just absent from it.
    candidates: list[ActionSpec] = []
    for tier in tiers:
        candidates.extend(actions_for_tier(tier))
    if 2 in tiers:
        candidates.extend(actions_for_tier(3))

    for spec in candidates:
        device = by_kind.get(spec.device_kind) if spec.device_kind else None
        device_zone = device["zone"] if device else None

        verdict = may_execute_autonomously(
            spec, device_zone=device_zone, affected_zones=zone_set
        )

        # An action needing a device we do not have is not a refusal by the
        # envelope — there is simply nothing to drive. Skip it silently rather
        # than claiming we declined it on safety grounds.
        if spec.device_kind and device is None and verdict.allowed:
            continue

        if not verdict.allowed:
            status = "refused"
        elif not settings.response_auto_enabled:
            # Master switch off: record what we would have done, execute nothing.
            status = "refused"
            verdict = Verdict(
                allowed=False,
                clauses=verdict.clauses,
                reason="Automatic response is paused; this would have armed.",
            )
        elif spec.tier == 0:
            # Evidence preservation changes no plant state, so there is nothing
            # to abort and no reason to make anyone wait for it.
            status = "active"
        else:
            status = "armed"

        row = await repo.insert_action(
            session,
            review_id=review_id,
            asset_id=asset_id,
            tier=spec.tier,
            action_kind=spec.kind,
            device_id=device["id"] if device else None,
            target_ref=None,
            status=status,
            envelope=envelope_payload(spec, verdict),
            refusal_reason=verdict.reason or None,
            actor=actor,
            arm_window_seconds=settings.response_arm_window_seconds,
        )
        if row is None:
            # Tier 0 already recorded for this review — the partial unique index
            # did its job. This is the expected path on a re-assessment.
            continue

        created.append(row)
        await _audit_action(
            session,
            row,
            event="response.action_armed" if status == "armed" else (
                "response.tier0_evidence_preserved"
                if spec.tier == 0
                else "response.action_refused"
            ),
            actor=actor,
            extra={"risk_level": risk_level, "zones": zones},
        )

    if created:
        logger.info(
            "response: review=%s risk=%s armed=%d refused=%d",
            review_id,
            risk_level,
            sum(1 for r in created if r["status"] == "armed"),
            sum(1 for r in created if r["status"] == "refused"),
        )
    return created


# --- Executing, aborting, revoking -------------------------------------------


async def execute_action(session: AsyncSession, action: dict[str, Any]) -> bool:
    """
    Apply one armed action whose window has elapsed. Caller owns the commit.
    """
    spec = ACTION_REGISTRY.get(action["action_kind"])
    if spec is None:  # pragma: no cover - registry drift
        logger.error("unknown action kind %s", action["action_kind"])
        return False

    await repo.mark_executed(session, action["id"])

    device_payload = None
    if action.get("device_id") and spec.commanded_state:
        device_payload = await repo.set_device_state(
            session, action["device_id"], spec.commanded_state
        )

    if spec.kind == "page_response_team":
        await dispatch_first_page(
            session, action_id=action["id"], review_id=action["review_id"]
        )

    await _audit_action(
        session,
        action,
        event="response.action_executed",
        actor=ORCHESTRATOR_ACTOR,
        extra={"commanded_state": spec.commanded_state},
    )
    await manager.broadcast(
        "response.action_executed",
        {
            "action_id": str(action["id"]),
            "review_id": str(action["review_id"]),
            "action_kind": spec.kind,
            "tier": spec.tier,
            "label": spec.label,
        },
    )
    if device_payload:
        await _broadcast_device(device_payload)
    return True


async def abort_action(
    session: AsyncSession, action_id: UUID, *, actor: str
) -> dict[str, Any] | None:
    """Cancel during the arming window. Returns None if it already executed."""
    if not await repo.mark_aborted(session, action_id, actor=actor):
        return None
    action = await repo.get_action(session, action_id)
    if action:
        await _audit_action(
            session, action, event="response.action_aborted", actor=actor
        )
        await manager.broadcast(
            "response.action_revoked",
            {
                "action_id": str(action_id),
                "review_id": str(action["review_id"]),
                "status": "aborted",
            },
        )
    return action


async def revoke_action(
    session: AsyncSession, action_id: UUID, *, actor: str, reason: str | None
) -> dict[str, Any] | None:
    """
    Undo an active action and revert its device to the fail-safe state.

    The revocation is itself chained, so "who turned the ventilation back off,
    and why" is as auditable as the decision to turn it on.
    """
    action = await repo.get_action(session, action_id)
    if action is None:
        return None
    if not await repo.mark_revoked(session, action_id, actor=actor, reason=reason):
        return None

    device_payload = None
    if action.get("device_id"):
        # Revert to the device's *default* (pre-action) state, not its fail-safe
        # state. For a tool gate those differ: fail-safe is closed, but normal
        # operation is open, and revoking "gate closed" must reopen it. The
        # fail-safe state describes loss of control, which is a different event.
        revert_to = action.get("default_state") or action.get("fail_safe_state")
        if revert_to:
            device_payload = await repo.set_device_state(
                session, action["device_id"], revert_to
            )

    if action["action_kind"] == "page_response_team":
        # A page cannot be un-sent; the reversal is a stand-down to everyone
        # already contacted. This is what makes paging satisfy clause 1.
        await _stand_down_pages(session, action_id=action_id, actor=actor)

    await _audit_action(
        session,
        action,
        event="response.action_revoked",
        actor=actor,
        extra={"reason": reason},
    )
    await manager.broadcast(
        "response.action_revoked",
        {
            "action_id": str(action_id),
            "review_id": str(action["review_id"]),
            "status": "revoked",
            "reason": reason,
        },
    )
    if device_payload:
        await _broadcast_device(device_payload)
    return action


# --- Paging ------------------------------------------------------------------


async def dispatch_first_page(
    session: AsyncSession, *, action_id: UUID, review_id: UUID
) -> dict[str, Any] | None:
    action = await repo.get_action(session, action_id)
    if action is None:
        return None
    _, zones = await affected_zones(session, action["asset_id"])
    contacts = await repo.contacts_for_zones(session, zones)
    if not contacts:
        logger.warning("no response contacts for zones %s", zones)
        return None
    return await _dispatch(session, action_id, review_id, contacts[0])


async def escalate_page(
    session: AsyncSession, page: dict[str, Any]
) -> dict[str, Any] | None:
    """
    Nobody acknowledged in time — try the next contact in the chain.

    Exhausting the chain is recorded and raises an in-app notification rather
    than failing silently; an unanswered page that nobody hears about is worse
    than no page at all.
    """
    action = await repo.get_action(session, page["action_id"])
    if action is None:
        return None
    _, zones = await affected_zones(session, action["asset_id"])
    contacts = await repo.contacts_for_zones(session, zones)
    nxt = [
        c for c in contacts if c["escalation_order"] > page["escalation_order"]
    ]
    if not nxt:
        await repo.mark_page_exhausted(session, page["id"])
        await _notify_escalation_exhausted(session, page)
        return None

    await repo.mark_page_escalated(session, page["id"])
    return await _dispatch(
        session,
        page["action_id"],
        page["review_id"],
        nxt[0],
        escalated_from_id=page["id"],
    )


async def acknowledge_page(
    session: AsyncSession, page_id: UUID, *, actor: str
) -> dict[str, Any] | None:
    """Human acknowledgement. Never automatic — that is the point of the signal."""
    row = await repo.acknowledge_page(session, page_id, actor=actor)
    if row is None:
        return None
    await record_audit(
        session,
        entity_type="response_page",
        entity_id=row["id"],
        event_type="response.page_acknowledged",
        actor=actor,
        payload={
            "review_id": str(row["review_id"]),
            "role": row["role"],
            "zone": row["zone"],
            "channel": row["channel"],
            "escalation_order": row["escalation_order"],
        },
    )
    await manager.broadcast(
        "response.page_acknowledged",
        {
            "page_id": str(row["id"]),
            "action_id": str(row["action_id"]),
            "review_id": str(row["review_id"]),
            "role": row["role"],
            "acknowledged_by": actor,
        },
    )
    return row


async def _dispatch(
    session: AsyncSession,
    action_id: UUID,
    review_id: UUID,
    contact: dict[str, Any],
    *,
    escalated_from_id: UUID | None = None,
) -> dict[str, Any]:
    channel = channel_for_order(int(contact["escalation_order"]))
    page = await repo.insert_page(
        session,
        action_id=action_id,
        review_id=review_id,
        contact=contact,
        channel=channel,
        escalated_from_id=escalated_from_id,
    )
    await record_audit(
        session,
        entity_type="response_page",
        entity_id=page["id"],
        event_type="response.page_dispatched",
        actor=ORCHESTRATOR_ACTOR,
        payload={
            "review_id": str(review_id),
            "role": contact["role"],
            "zone": contact["zone"],
            "channel": channel,
            "escalation_order": contact["escalation_order"],
            "escalated_from_id": (
                str(escalated_from_id) if escalated_from_id else None
            ),
            # Recorded on the chain so the audit shows this was never a real
            # message to a real person.
            "simulated": True,
        },
    )
    await manager.broadcast(
        "response.page_dispatched",
        {
            "page_id": str(page["id"]),
            "action_id": str(action_id),
            "review_id": str(review_id),
            "role": contact["role"],
            "zone": contact["zone"],
            "channel": channel,
            "escalation_order": contact["escalation_order"],
            "simulated": True,
        },
    )
    return page


async def _stand_down_pages(
    session: AsyncSession, *, action_id: UUID, actor: str
) -> None:
    outstanding = await repo.dispatched_pages_for_action(session, action_id)
    for page in outstanding:
        await record_audit(
            session,
            entity_type="response_page",
            entity_id=page["id"],
            event_type="response.page_stood_down",
            actor=actor,
            payload={"role": page["role"], "channel": page["channel"]},
        )


async def _notify_escalation_exhausted(
    session: AsyncSession, page: dict[str, Any]
) -> None:
    from app.notifications.service import create_notification

    result = await session.execute(
        text("SELECT owner_id FROM reviews WHERE id = CAST(:id AS uuid)"),
        {"id": str(page["review_id"])},
    )
    row = result.first()
    if row is None:
        return
    await create_notification(
        session,
        review_id=page["review_id"],
        event_type="response.page_escalation_exhausted",
        summary=(
            f"No acknowledgement from any {page['zone']} responder — "
            "escalation chain exhausted"
        ),
        recipient_ids=[row._mapping["owner_id"]],
    )


# --- Shared helpers ----------------------------------------------------------


async def _audit_action(
    session: AsyncSession,
    action: dict[str, Any],
    *,
    event: str,
    actor: str,
    extra: dict[str, Any] | None = None,
) -> None:
    payload = {
        "review_id": str(action["review_id"]),
        "tier": action["tier"],
        "action_kind": action["action_kind"],
        "status": action.get("status"),
        "envelope": action.get("envelope"),
        **(extra or {}),
    }
    await record_audit(
        session,
        entity_type="response_action",
        entity_id=action["id"],
        event_type=event,
        actor=actor,
        payload=payload,
    )


async def _broadcast_device(device: dict[str, Any]) -> None:
    await manager.broadcast(
        "response.device_changed",
        {
            "device_id": str(device["id"]),
            "zone": device["zone"],
            "kind": device["kind"],
            "label": device["label"],
            "state": device["state"],
            "simulated": device.get("simulated", True),
        },
    )
