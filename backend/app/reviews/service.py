from __future__ import annotations

from uuid import UUID

from app.context.derived_facts import load_valid_context
from app.context.schemas import ReviewDetailOut
from app.decisions.service import get_decision_for_review
from shared.python.schemas import Context
from shared.python.schemas import DerivedFact, Review
from app.reviews.state_machine import ReviewEvent
from app.reviews.repository import create_review, get_review, transition_review
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import get_settings


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
    # Deferred to avoid circular import with context.service → reviews.service.
    from app.context.service import get_asset
    from app.reviews.ownership import get_zone_owner, resolve_worker_names
    from shared.python.schemas import Asset

    review = await get_review(session, review_id)
    if review is None:
        return None

    asset = await get_asset(session, review.asset_id)
    if asset is None:
        asset = Asset(
            id=review.asset_id,
            name="unknown",
            zone="unknown",
            plant_id="unknown",
        )

    entries = await load_valid_context(session, review.asset_id)
    worker_ids = [
        str(e.payload.get("worker_id"))
        for e in entries
        if e.category in ("worker_location", "certification")
        and e.payload.get("worker_id")
    ]
    name_map = await resolve_worker_names(session, worker_ids)

    context = []
    for e in entries:
        payload = dict(e.payload)
        wid = payload.get("worker_id")
        if wid and str(wid) in name_map:
            payload["worker_name"] = name_map[str(wid)]
        context.append(
            Context(
                id=e.id,
                asset_id=e.asset_id,
                category=e.category,
                payload=payload,
                provider=e.provider,
                valid_from=e.valid_from,
                valid_until=e.valid_until,
                confidence=e.confidence,
            )
        )

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

    decision = await get_decision_for_review(session, review_id)
    area_owner = await get_zone_owner(session, asset.zone)
    return ReviewDetailOut(
        review=review,
        asset=asset,
        context=context,
        derived_facts=derived,
        decision=decision,
        area_owner=area_owner,
    )


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
