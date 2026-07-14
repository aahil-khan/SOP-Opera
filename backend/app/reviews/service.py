from __future__ import annotations

from uuid import UUID

from shared.python.schemas import DerivedFact, Review
from app.reviews.state_machine import ReviewEvent
from app.reviews.repository import create_review, get_review, transition_review
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import get_settings
from app.context.derived_facts import load_valid_context
from app.context.schemas import ReviewDetailOut
from shared.python.schemas import Context


REASSESSABLE_STATES = frozenset({"opened", "pending_decision", "reopened"})
ACTIVE_REVIEW_STATES = frozenset(
    {
        "opened",
        "assessing",
        "pending_decision",
        "escalated",
        "decided",
        "reopened",
    }
)


def should_reassess(
    review: Review | None,
    changed_fact_types: list[str],
    current_true_facts: list[DerivedFact],
) -> bool:
    """Deterministic reassessment / auto-open gate (Phase 2; Phase 3 extends)."""
    if not changed_fact_types:
        return False
    if review is None:
        newly_true = {
            f.fact_type for f in current_true_facts
        } & set(changed_fact_types)
        return bool(newly_true)
    return review.state in REASSESSABLE_STATES


async def find_active_review_for_asset(
    session: AsyncSession, asset_id: UUID
) -> Review | None:
    result = await session.execute(
        text(
            """
            SELECT id, asset_id, state, owner_id, triggered_by, created_at
            FROM reviews
            WHERE asset_id = CAST(:asset_id AS uuid)
              AND state <> 'closed'
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"asset_id": str(asset_id)},
    )
    row = result.first()
    if row is None:
        return None
    m = row._mapping
    return Review(
        id=m["id"],
        asset_id=m["asset_id"],
        state=m["state"],
        owner_id=m["owner_id"],
        triggered_by=m["triggered_by"],
        created_at=m["created_at"],
    )


async def handle_context_change(
    session: AsyncSession,
    asset_id: UUID,
    changed_fact_types: list[str],
    current_true_facts: list[DerivedFact],
    *,
    actor: str = "system:context",
) -> Review | None:
    review = await find_active_review_for_asset(session, asset_id)
    if not should_reassess(review, changed_fact_types, current_true_facts):
        return review

    if review is None:
        triggered = ",".join(sorted(changed_fact_types))
        owner = UUID(get_settings().default_owner_user_id)
        review = await create_review(
            session,
            asset_id=asset_id,
            triggered_by=triggered,
            owner_id=owner,
            actor=actor,
        )
        review = await transition_review(
            session,
            review.id,
            ReviewEvent.TRIGGER_ASSESSMENT,
            actor,
            extra_payload={"changed_fact_types": changed_fact_types},
        )
        return review

    return await transition_review(
        session,
        review.id,
        ReviewEvent.TRIGGER_ASSESSMENT,
        actor,
        extra_payload={"changed_fact_types": changed_fact_types},
    )


async def get_review_detail(
    session: AsyncSession, review_id: UUID
) -> ReviewDetailOut | None:
    review = await get_review(session, review_id)
    if review is None:
        return None

    entries = await load_valid_context(session, review.asset_id)
    context = [
        Context(
            id=e.id,
            asset_id=e.asset_id,
            category=e.category,
            payload=e.payload,
            provider=e.provider,
            valid_from=e.valid_from,
            valid_until=e.valid_until,
            confidence=e.confidence,
        )
        for e in entries
    ]

    facts_result = await session.execute(
        text(
            """
            SELECT DISTINCT ON (fact_type)
                id, asset_id, fact_type, value, computed_at, source_context_ids
            FROM derived_facts
            WHERE asset_id = CAST(:asset_id AS uuid)
            ORDER BY fact_type, computed_at DESC
            """
        ),
        {"asset_id": str(review.asset_id)},
    )
    derived: list[DerivedFact] = []
    for row in facts_result.fetchall():
        m = row._mapping
        value = m["value"]
        if isinstance(value, dict):
            value = value.get("value", value)
        if not value:
            continue
        derived.append(
            DerivedFact(
                id=m["id"],
                asset_id=m["asset_id"],
                fact_type=m["fact_type"],
                value=True if value is True or value == "true" else value,
                computed_at=m["computed_at"],
                source_context_ids=list(m["source_context_ids"] or []),
            )
        )

    return ReviewDetailOut(review=review, context=context, derived_facts=derived)


async def list_reviews(
    session: AsyncSession,
    *,
    state: str | None = None,
    asset_id: UUID | None = None,
) -> list[Review]:
    clauses = ["1=1"]
    params: dict = {}
    if state:
        clauses.append("state = :state")
        params["state"] = state
    if asset_id:
        clauses.append("asset_id = CAST(:asset_id AS uuid)")
        params["asset_id"] = str(asset_id)
    where = " AND ".join(clauses)
    result = await session.execute(
        text(
            f"""
            SELECT id, asset_id, state, owner_id, triggered_by, created_at
            FROM reviews
            WHERE {where}
            ORDER BY created_at DESC
            """
        ),
        params,
    )
    out: list[Review] = []
    for row in result.fetchall():
        m = row._mapping
        out.append(
            Review(
                id=m["id"],
                asset_id=m["asset_id"],
                state=m["state"],
                owner_id=m["owner_id"],
                triggered_by=m["triggered_by"],
                created_at=m["created_at"],
            )
        )
    return out
