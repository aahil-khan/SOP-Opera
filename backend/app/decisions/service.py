"""Decision service — submit decision, update dispositions, freeze evidence."""

from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.context.derived_facts import load_valid_context
from app.core.config import get_settings
from app.decisions.schemas import DecisionIn
from app.realtime.connection_manager import manager
from app.reviews.ownership import get_zone_owner
from app.reviews.repository import get_review, transition_review
from app.reviews.state_machine import IllegalTransitionError, ReviewEvent
from shared.python.schemas import Decision

logger = logging.getLogger(__name__)

DECISIONABLE_STATES = frozenset({"pending_decision"})


class DecisionError(Exception):
    """Business-rule failure for decision submission (maps to 4xx)."""

    def __init__(self, message: str, *, status_code: int = 409) -> None:
        self.status_code = status_code
        super().__init__(message)


async def _load_complete_assessment(
    session: AsyncSession, review_id: UUID
) -> tuple[UUID, str | None] | None:
    result = await session.execute(
        text(
            """
            SELECT id, risk_level FROM assessments
            WHERE review_id = CAST(:review_id AS uuid)
              AND status = 'complete'
            ORDER BY version DESC, created_at DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review_id)},
    )
    row = result.first()
    if row is None:
        return None
    m = row._mapping
    return m["id"], m.get("risk_level")


async def _recommendation_ids_for_assessment(
    session: AsyncSession, assessment_id: UUID
) -> set[UUID]:
    result = await session.execute(
        text(
            """
            SELECT id FROM recommendations
            WHERE assessment_id = CAST(:aid AS uuid)
            """
        ),
        {"aid": str(assessment_id)},
    )
    return {row._mapping["id"] for row in result.fetchall()}


async def get_decision_for_review(
    session: AsyncSession, review_id: UUID
) -> Decision | None:
    result = await session.execute(
        text(
            """
            SELECT id, review_id, assessment_id, decided_by, outcome,
                   conditions, comments, submitted_at
            FROM decisions
            WHERE review_id = CAST(:review_id AS uuid)
            ORDER BY submitted_at DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review_id)},
    )
    row = result.first()
    if row is None:
        return None
    m = row._mapping
    disp_result = await session.execute(
        text(
            """
            SELECT id, disposition FROM recommendations
            WHERE assessment_id = CAST(:aid AS uuid)
              AND disposition IN ('accepted', 'rejected')
            """
        ),
        {"aid": str(m["assessment_id"])},
    )
    dispositions: dict[UUID, Literal["accepted", "rejected"]] = {}
    for r in disp_result.fetchall():
        d = r._mapping["disposition"]
        if d in ("accepted", "rejected"):
            dispositions[r._mapping["id"]] = d

    return Decision(
        id=m["id"],
        review_id=m["review_id"],
        assessment_id=m["assessment_id"],
        decided_by=m["decided_by"],
        outcome=m["outcome"],
        recommendation_dispositions=dispositions,
        conditions=m["conditions"],
        comments=m.get("comments"),
        submitted_at=m["submitted_at"],
    )


async def submit_decision(
    session: AsyncSession,
    review_id: UUID,
    body: DecisionIn,
    *,
    actor: str = "api:decision",
) -> Decision:
    review = await get_review(session, review_id)
    if review is None:
        raise LookupError(f"Review {review_id} not found")
    if review.state not in DECISIONABLE_STATES:
        raise DecisionError(
            f"Decision only allowed in pending_decision "
            f"(current={review.state})",
            status_code=409,
        )

    assessment_meta = await _load_complete_assessment(session, review_id)
    if assessment_meta is None:
        raise DecisionError(
            "A complete Assessment is required before a Decision can be submitted",
            status_code=409,
        )
    assessment_id, assessment_risk_level = assessment_meta
    if assessment_risk_level == "blocking" and body.outcome != "blocked":
        raise DecisionError(
            "Blocking assessments can only be submitted with outcome=blocked",
            status_code=409,
        )

    known_rec_ids = await _recommendation_ids_for_assessment(session, assessment_id)
    unknown = set(body.recommendation_dispositions.keys()) - known_rec_ids
    if unknown:
        raise DecisionError(
            f"Unknown recommendation ids for this assessment: "
            f"{sorted(str(u) for u in unknown)}",
            status_code=400,
        )

    decided_by = UUID(get_settings().default_owner_user_id)
    conditions = (
        body.conditions.strip()
        if body.outcome == "approved_with_conditions" and body.conditions
        else None
    )
    comments = body.comments.strip() if body.comments and body.comments.strip() else None

    result = await session.execute(
        text(
            """
            INSERT INTO decisions (
                review_id, assessment_id, decided_by, outcome, conditions, comments
            )
            VALUES (
                CAST(:review_id AS uuid),
                CAST(:assessment_id AS uuid),
                CAST(:decided_by AS uuid),
                :outcome,
                :conditions,
                :comments
            )
            RETURNING id, review_id, assessment_id, decided_by, outcome,
                      conditions, comments, submitted_at
            """
        ),
        {
            "review_id": str(review_id),
            "assessment_id": str(assessment_id),
            "decided_by": str(decided_by),
            "outcome": body.outcome,
            "conditions": conditions,
            "comments": comments,
        },
    )
    dm = result.one()._mapping
    decision_id = dm["id"]

    for rec_id, disposition in body.recommendation_dispositions.items():
        await session.execute(
            text(
                """
                UPDATE recommendations
                SET disposition = :disposition
                WHERE id = CAST(:id AS uuid)
                  AND assessment_id = CAST(:aid AS uuid)
                """
            ),
            {
                "id": str(rec_id),
                "aid": str(assessment_id),
                "disposition": disposition,
            },
        )

    valid_ctx = await load_valid_context(session, review.asset_id)
    frozen_ids = [str(e.id) for e in valid_ctx]
    evidence_result = await session.execute(
        text(
            """
            INSERT INTO evidence (
                review_id, decision_id, frozen_context_ids, frozen_assessment_id
            )
            VALUES (
                CAST(:review_id AS uuid),
                CAST(:decision_id AS uuid),
                CAST(:ctx AS uuid[]),
                CAST(:assessment_id AS uuid)
            )
            RETURNING id
            """
        ),
        {
            "review_id": str(review_id),
            "decision_id": str(decision_id),
            "ctx": frozen_ids,
            "assessment_id": str(assessment_id),
        },
    )
    evidence_id = evidence_result.scalar_one()

    await record_audit(
        session,
        entity_type="decision",
        entity_id=decision_id,
        event_type="decision.submitted",
        actor=actor,
        payload={
            "review_id": str(review_id),
            "assessment_id": str(assessment_id),
            "outcome": body.outcome,
            "conditions": conditions,
            "comments": comments,
        },
    )
    await record_audit(
        session,
        entity_type="evidence",
        entity_id=evidence_id,
        event_type="evidence.captured",
        actor=actor,
        payload={
            "review_id": str(review_id),
            "decision_id": str(decision_id),
            "frozen_context_ids": frozen_ids,
            "frozen_assessment_id": str(assessment_id),
        },
    )
    await session.commit()

    try:
        await transition_review(
            session,
            review_id,
            ReviewEvent.SUBMIT_DECISION,
            actor,
            extra_payload={
                "decision_id": str(decision_id),
                "assessment_id": str(assessment_id),
                "outcome": body.outcome,
            },
        )
    except IllegalTransitionError as exc:
        raise DecisionError(str(exc), status_code=409) from exc

    # Create HITL tasks for the zone owner + any additionally tagged workers.
    # Deferred to avoid circular import with context.service → reviews.service.
    from app.context.service import get_asset

    asset = await get_asset(session, review.asset_id)
    if asset is None:
        raise DecisionError("Asset not found for review", status_code=409)
    zone_owner = await get_zone_owner(session, asset.zone)
    if zone_owner is None:
        raise DecisionError(
            f"No zone owner configured for zone={asset.zone}",
            status_code=409,
        )

    assigned_worker_ids = list(
        {zone_owner.worker_id, *(body.tagged_worker_ids or [])}
    )
    from app.tasks.service import create_tasks_for_decision

    await create_tasks_for_decision(
        session,
        review_id=review_id,
        decision_id=decision_id,
        assigned_worker_ids=assigned_worker_ids,
        outcome=str(body.outcome),
        actor=actor,
    )

    # Replace the old random unblock timer with a real HITL unlock action.
    from app.simulator.engine import demo_controller

    if body.outcome == "blocked":
        demo_controller.lock_asset_inactive(asset_id=review.asset_id, review_id=review_id)
    else:
        demo_controller.clear_inactive_lock_for_review(review_id)

    await manager.broadcast(
        "decision.submitted",
        {
            "review_id": str(review_id),
            "decision_id": str(decision_id),
            "outcome": body.outcome,
            "assessment_id": str(assessment_id),
        },
    )

    return Decision(
        id=decision_id,
        review_id=review_id,
        assessment_id=assessment_id,
        decided_by=decided_by,
        outcome=body.outcome,
        recommendation_dispositions=dict(body.recommendation_dispositions),
        conditions=conditions,
        comments=comments,
        submitted_at=dm["submitted_at"],
    )
