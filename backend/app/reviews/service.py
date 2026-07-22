from __future__ import annotations

from uuid import UUID

from app.context.derived_facts import load_valid_context
from app.context.schemas import ReviewDetailOut
from shared.python.schemas import Context
from shared.python.schemas import DerivedFact, Review
from app.reviews.state_machine import ReviewEvent
from app.reviews.repository import create_review, get_review, transition_review
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import get_settings
from app.risk import policy as risk_policy
from app.risk.policy import CRITICAL_SENSOR_FACTS


REASSESSABLE_STATES = frozenset({"opened", "pending_decision", "reopened"})
ACTIVE_REVIEW_STATES = frozenset(
    {
        "opened",
        "assessing",
        "pending_decision",
        "decided",
        "reopened",
    }
)


def _active_rule_facts(current_true_facts: list[DerivedFact]) -> set[str]:
    return {
        f.fact_type
        for f in current_true_facts
        if f.value is True or f.value == "true"
    } - {"spatial_cooccurrence"}


def _is_blocking_compound(current_true_facts: list[DerivedFact]) -> bool:
    """Delegate to the one risk policy — see app/risk/policy.py."""
    return risk_policy.is_blocking_compound(_active_rule_facts(current_true_facts))


def _newly_true_facts(
    changed_fact_types: list[str],
    current_true_facts: list[DerivedFact],
) -> set[str]:
    true_types = _active_rule_facts(current_true_facts)
    return true_types & set(changed_fact_types)


def should_reopen_after_decision(
    changed_fact_types: list[str],
    current_true_facts: list[DerivedFact],
) -> bool:
    """Re-open a decided review when live context materially worsens."""
    newly_true = _newly_true_facts(changed_fact_types, current_true_facts)
    if not newly_true:
        return False
    if newly_true & CRITICAL_SENSOR_FACTS:
        return True
    return _is_blocking_compound(current_true_facts)


def should_reassess(
    review: Review | None,
    changed_fact_types: list[str],
    current_true_facts: list[DerivedFact],
) -> bool:
    """Deterministic reassessment / auto-open / reopen gate."""
    if not changed_fact_types:
        return False
    if review is None:
        newly_true = {
            f.fact_type for f in current_true_facts
        } & set(changed_fact_types)
        return bool(newly_true)
    if review.state in ("decided", "closed"):
        return should_reopen_after_decision(changed_fact_types, current_true_facts)
    return review.state in REASSESSABLE_STATES


async def find_active_review_for_asset(
    session: AsyncSession, asset_id: UUID
) -> Review | None:
    result = await session.execute(
        text(
            """
            SELECT id,
                   asset_id,
                   state,
                   owner_id,
                   triggered_by,
                   origin,
                   raised_by_worker_id,
                   created_at
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
        origin=m["origin"] if "origin" in m else "system",
        raised_by_worker_id=m["raised_by_worker_id"]
        if "raised_by_worker_id" in m
        else None,
        created_at=m["created_at"],
    )


async def find_latest_review_for_asset(
    session: AsyncSession, asset_id: UUID
) -> Review | None:
    """Most recent review for an asset, including closed."""
    result = await session.execute(
        text(
            """
            SELECT id,
                   asset_id,
                   state,
                   owner_id,
                   triggered_by,
                   origin,
                   raised_by_worker_id,
                   created_at
            FROM reviews
            WHERE asset_id = CAST(:asset_id AS uuid)
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
        origin=m["origin"] if "origin" in m else "system",
        raised_by_worker_id=m["raised_by_worker_id"]
        if "raised_by_worker_id" in m
        else None,
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

    # No open review — prefer reopening the latest closed one over creating a duplicate.
    if review is None:
        latest = await find_latest_review_for_asset(session, asset_id)
        if (
            latest is not None
            and latest.state == "closed"
            and should_reopen_after_decision(changed_fact_types, current_true_facts)
        ):
            review = await transition_review(
                session,
                latest.id,
                ReviewEvent.REOPEN,
                actor,
                extra_payload={"changed_fact_types": changed_fact_types},
            )
            return await transition_review(
                session,
                review.id,
                ReviewEvent.TRIGGER_ASSESSMENT,
                actor,
                extra_payload={"changed_fact_types": changed_fact_types},
            )
        if not should_reassess(None, changed_fact_types, current_true_facts):
            return latest
        triggered = ",".join(sorted(changed_fact_types))
        owner = UUID(get_settings().default_owner_user_id)
        review = await create_review(
            session,
            asset_id=asset_id,
            triggered_by=triggered,
            owner_id=owner,
            actor=actor,
        )
        return await transition_review(
            session,
            review.id,
            ReviewEvent.TRIGGER_ASSESSMENT,
            actor,
            extra_payload={"changed_fact_types": changed_fact_types},
        )

    if not should_reassess(review, changed_fact_types, current_true_facts):
        return review

    if review.state == "decided":
        review = await transition_review(
            session,
            review.id,
            ReviewEvent.RISK_RETURNED,
            actor,
            extra_payload={"changed_fact_types": changed_fact_types},
        )

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

    from app.decisions.service import get_decision_for_review
    from app.tasks.service import get_task_summary, list_tasks_for_review

    decision = await get_decision_for_review(session, review_id)
    decided_by_name: str | None = None
    if decision is not None:
        name_row = await session.execute(
            text(
                """
                SELECT name
                FROM users
                WHERE id = CAST(:uid AS uuid)
                """
            ),
            {"uid": str(decision.decided_by)},
        )
        name_result = name_row.first()
        if name_result is not None:
            decided_by_name = name_result._mapping["name"]
    area_owner = await get_zone_owner(session, asset.zone)
    raised_by_worker_name: str | None = None
    supervisor_report = None
    if review.raised_by_worker_id is not None:
        name_result = await session.execute(
            text(
                """
                SELECT name
                FROM workers
                WHERE id = CAST(:wid AS uuid)
                """
            ),
            {"wid": str(review.raised_by_worker_id)},
        )
        row = name_result.first()
        if row is not None:
            raised_by_worker_name = row._mapping["name"]

    if review.origin == "supervisor":
        from app.context.schemas import SupervisorReportOut
        from app.reviews.concerns import normalize_concern_type

        report_row = await session.execute(
            text(
                """
                SELECT report_description, report_concern_type
                FROM reviews
                WHERE id = CAST(:rid AS uuid)
                """
            ),
            {"rid": str(review_id)},
        )
        rr = report_row.first()
        if rr is not None:
            desc = rr._mapping["report_description"]
            concern = normalize_concern_type(rr._mapping["report_concern_type"])
            if isinstance(desc, str) and desc.strip():
                supervisor_report = SupervisorReportOut(
                    description=desc.strip(),
                    concern_type=concern,  # type: ignore[arg-type]
                    reported_by_name=raised_by_worker_name or "Supervisor",
                )
            else:
                for ctx in context:
                    if ctx.category != "supervisor_report":
                        continue
                    payload = ctx.payload or {}
                    fallback_desc = str(payload.get("description") or "").strip()
                    if fallback_desc:
                        supervisor_report = SupervisorReportOut(
                            description=fallback_desc,
                            concern_type=normalize_concern_type(
                                payload.get("concern_type")
                            ),  # type: ignore[arg-type]
                            reported_by_name=str(
                                payload.get("reported_by")
                                or raised_by_worker_name
                                or "Supervisor"
                            ),
                        )
                        break

    task_summary = await get_task_summary(session, review_id=review_id)
    tasks = await list_tasks_for_review(session, review_id=review_id)

    return ReviewDetailOut(
        review=review,
        asset=asset,
        context=context,
        derived_facts=derived,
        decision=decision,
        decided_by_name=decided_by_name,
        area_owner=area_owner,
        raised_by_worker_name=raised_by_worker_name,
        supervisor_report=supervisor_report,
        task_summary=task_summary,
        tasks=tasks,
    )


DEFAULT_REVIEW_LIST_LIMIT = 200
MAX_REVIEW_LIST_LIMIT = 1000


def _clamp_review_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_REVIEW_LIST_LIMIT
    return max(1, min(int(limit), MAX_REVIEW_LIST_LIMIT))


async def list_reviews(
    session: AsyncSession,
    *,
    state: str | None = None,
    asset_id: UUID | None = None,
    limit: int | None = None,
) -> list[Review]:
    """
    Most-recent reviews first, bounded.

    This is the single most-called endpoint — every connected client refetches it
    on every domain event — and it previously returned every review ever created.
    The worker-scoped variants below already had a LIMIT; this one was missed.
    """
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
            SELECT id,
                   asset_id,
                   state,
                   owner_id,
                   triggered_by,
                   origin,
                   raised_by_worker_id,
                   created_at
            FROM reviews
            WHERE {where}
            ORDER BY created_at DESC
            LIMIT :limit
            """
        ),
        {**params, "limit": _clamp_review_limit(limit)},
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
                origin=m["origin"] if "origin" in m else "system",
                raised_by_worker_id=m["raised_by_worker_id"]
                if "raised_by_worker_id" in m
                else None,
                created_at=m["created_at"],
            )
        )
    return out


async def list_shared_reviews_for_worker(
    session: AsyncSession,
    *,
    worker_id: UUID,
) -> list:
    from app.reviews.schemas import SharedReviewOut

    result = await session.execute(
        text(
            """
            SELECT
              r.id AS review_id,
              r.asset_id,
              r.state AS review_state,
              r.created_at,
              r.origin,
              a.name AS asset_name,
              a.zone AS asset_zone,
              COALESCE(w.name, 'Unknown') AS raised_by_name,
              COALESCE(
                NULLIF(r.report_description, ''),
                (
                  SELECT ce.payload->>'description'
                  FROM context_entries ce
                  WHERE ce.asset_id = r.asset_id
                    AND ce.category = 'supervisor_report'
                  ORDER BY ce.valid_from DESC
                  LIMIT 1
                ),
                'Floor issue reported'
              ) AS description,
              COALESCE(
                NULLIF(r.report_concern_type, ''),
                'other'
              ) AS concern_type
            FROM reviews r
            JOIN assets a ON a.id = r.asset_id
            LEFT JOIN workers w ON w.id = r.raised_by_worker_id
            WHERE CAST(:wid AS uuid) = ANY(r.tagged_worker_ids)
              AND r.state <> 'closed'
            ORDER BY r.created_at DESC
            LIMIT 50
            """
        ),
        {"wid": str(worker_id)},
    )
    out: list[SharedReviewOut] = []
    for row in result.fetchall():
        m = row._mapping
        out.append(
            SharedReviewOut(
                review_id=m["review_id"],
                asset_id=m["asset_id"],
                asset_name=m["asset_name"],
                asset_zone=m["asset_zone"],
                review_state=m["review_state"],
                description=m["description"],
                concern_type=m["concern_type"],
                raised_by_name=m["raised_by_name"],
                created_at=m["created_at"],
                origin=m["origin"] if "origin" in m else "system",
                source="shared",
            )
        )
    return out


async def list_raised_reviews_for_worker(
    session: AsyncSession,
    *,
    worker_id: UUID,
) -> list:
    from app.reviews.schemas import SharedReviewOut

    result = await session.execute(
        text(
            """
            SELECT
              r.id AS review_id,
              r.asset_id,
              r.state AS review_state,
              r.created_at,
              r.origin,
              a.name AS asset_name,
              a.zone AS asset_zone,
              COALESCE(w.name, 'Unknown') AS raised_by_name,
              COALESCE(
                NULLIF(r.report_description, ''),
                'Floor issue reported'
              ) AS description,
              COALESCE(
                NULLIF(r.report_concern_type, ''),
                'other'
              ) AS concern_type
            FROM reviews r
            JOIN assets a ON a.id = r.asset_id
            LEFT JOIN workers w ON w.id = r.raised_by_worker_id
            WHERE r.raised_by_worker_id = CAST(:wid AS uuid)
              AND r.origin = 'supervisor'
              AND r.state <> 'closed'
            ORDER BY r.created_at DESC
            LIMIT 50
            """
        ),
        {"wid": str(worker_id)},
    )
    out: list[SharedReviewOut] = []
    for row in result.fetchall():
        m = row._mapping
        out.append(
            SharedReviewOut(
                review_id=m["review_id"],
                asset_id=m["asset_id"],
                asset_name=m["asset_name"],
                asset_zone=m["asset_zone"],
                review_state=m["review_state"],
                description=m["description"],
                concern_type=m["concern_type"],
                raised_by_name=m["raised_by_name"],
                created_at=m["created_at"],
                origin=m["origin"] if "origin" in m else "supervisor",
                source="raised",
            )
        )
    return out


async def list_zone_reviews_for_worker(
    session: AsyncSession,
    *,
    worker_id: UUID,
) -> list:
    """Open reviews on assets in zones this worker owns (pre-decision visibility)."""
    from app.reviews.schemas import SharedReviewOut

    result = await session.execute(
        text(
            """
            SELECT
              r.id AS review_id,
              r.asset_id,
              r.state AS review_state,
              r.created_at,
              r.origin,
              r.triggered_by,
              a.name AS asset_name,
              a.zone AS asset_zone,
              COALESCE(w.name, NULL) AS raised_by_name,
              COALESCE(
                NULLIF(r.report_description, ''),
                NULLIF(REPLACE(r.triggered_by, ',', ' · '), ''),
                'Open work in your zone'
              ) AS description,
              COALESCE(
                NULLIF(r.report_concern_type, ''),
                'other'
              ) AS concern_type
            FROM reviews r
            JOIN assets a ON a.id = r.asset_id
            JOIN zone_owners zo ON zo.zone = a.zone
            LEFT JOIN workers w ON w.id = r.raised_by_worker_id
            WHERE zo.worker_id = CAST(:wid AS uuid)
              AND r.state <> 'closed'
            ORDER BY r.created_at DESC
            LIMIT 50
            """
        ),
        {"wid": str(worker_id)},
    )
    out: list[SharedReviewOut] = []
    for row in result.fetchall():
        m = row._mapping
        origin = m["origin"] if "origin" in m else "system"
        raised_name = m["raised_by_name"]
        if not raised_name:
            if origin == "operator":
                raised_name = "Operator"
            elif origin == "supervisor":
                raised_name = "Supervisor"
            else:
                raised_name = "Live signals"
        out.append(
            SharedReviewOut(
                review_id=m["review_id"],
                asset_id=m["asset_id"],
                asset_name=m["asset_name"],
                asset_zone=m["asset_zone"],
                review_state=m["review_state"],
                description=m["description"],
                concern_type=m["concern_type"],
                raised_by_name=raised_name,
                created_at=m["created_at"],
                origin=origin,
                source="zone",
            )
        )
    return out
