from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.assessment.manual import create_manual_assessment, list_assessments
from app.assessment.orchestrator import enqueue_for_review
from app.assessment.schemas import AssessmentOut, RetryIn
from app.core.config import get_settings
from app.db.session import get_session
from app.reviews.repository import (
    create_review,
    get_review,
    transition_review,
    update_review_supervisor_report,
)
from app.reviews.schemas import CreateReviewIn, EscalateIn, ReopenIn, ReviewDetailOut, SharedReviewOut
from app.reviews.service import (
    find_active_review_for_asset,
    find_latest_review_for_asset,
    get_review_detail,
    list_raised_reviews_for_worker,
    list_reviews,
    list_shared_reviews_for_worker,
)
from app.reviews.state_machine import IllegalTransitionError, ReviewEvent
from app.reviews.comments_service import (
    ReviewCommentIn,
    ReviewCommentOut,
    create_review_comment,
    list_review_comments,
)
from app.auth.routes import get_current_actor
from app.auth.schemas import ActorMeOut
from app.reviews.concerns import normalize_concern_type
from shared.python.schemas import Assessment, ManualAssessmentIn, Review

router = APIRouter(prefix="/reviews", tags=["reviews"])


async def _normalize_tagged_workers(
    session: AsyncSession,
    *,
    tagged_worker_ids: list[UUID],
    raised_by_worker_id: UUID,
) -> list[UUID]:
    """Validate supervisor tags: workers only, no self-tag, deduped."""
    ordered: list[UUID] = []
    seen: set[UUID] = set()
    for wid in tagged_worker_ids:
        if wid in seen:
            continue
        if wid == raised_by_worker_id:
            continue
        seen.add(wid)
        ordered.append(wid)

    if not ordered:
        return []

    result = await session.execute(
        text(
            """
            SELECT id
            FROM workers
            WHERE id = ANY(CAST(:ids AS uuid[]))
            """
        ),
        {"ids": [str(w) for w in ordered]},
    )
    found = {UUID(str(row._mapping["id"])) for row in result.fetchall()}
    missing = [w for w in ordered if w not in found]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown worker id(s): {', '.join(str(x) for x in missing)}",
        )
    return ordered


@router.post("", response_model=Review, status_code=201)
async def post_review(
    body: CreateReviewIn,
    session: AsyncSession = Depends(get_session),
) -> Review:
    owner_id = body.owner_id or UUID(get_settings().default_owner_user_id)

    from app.context.derived_facts import compute_and_persist
    from app.context.service import asset_exists

    if not await asset_exists(session, body.asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")

    # Supervisor-raised issue follow-through (HITL narrative)
    if body.description is not None:
        if body.raised_by_worker_id is None:
            raise HTTPException(
                status_code=422,
                detail="raised_by_worker_id is required when description is set",
            )

        now = datetime.now(timezone.utc)
        valid_from = now
        valid_until = now + timedelta(hours=4)

        name_result = await session.execute(
            text(
                """
                SELECT name
                FROM workers
                WHERE id = CAST(:wid AS uuid)
                """
            ),
            {"wid": str(body.raised_by_worker_id)},
        )
        worker_row = name_result.first()
        reported_by_name = (
            worker_row._mapping["name"] if worker_row is not None else "Unknown"
        )

        concern_type = normalize_concern_type(body.concern_type)

        payload = {
            "description": body.description,
            "reported_by": reported_by_name,
            "concern_type": concern_type,
        }

        await session.execute(
            text(
                """
                INSERT INTO context_entries (
                    asset_id, category, payload, provider,
                    valid_from, valid_until, confidence
                )
                VALUES (
                    CAST(:asset_id AS uuid),
                    :category,
                    CAST(:payload AS jsonb),
                    :provider,
                    :valid_from,
                    :valid_until,
                    :confidence
                )
                """
            ),
            {
                "asset_id": str(body.asset_id),
                "category": "supervisor_report",
                "payload": json.dumps(payload),
                "provider": "supervisor",
                "valid_from": valid_from,
                "valid_until": valid_until,
                "confidence": 1.0,
            },
        )

        # Ensure derived facts are re-evaluated so assessments have the latest
        # persisted fact-state + the supervisor report context entry.
        await compute_and_persist(session, body.asset_id, now=now)

        tagged_worker_ids = await _normalize_tagged_workers(
            session,
            tagged_worker_ids=body.tagged_worker_ids,
            raised_by_worker_id=body.raised_by_worker_id,
        )

        asset_name_result = await session.execute(
            text("SELECT name FROM assets WHERE id = CAST(:aid AS uuid)"),
            {"aid": str(body.asset_id)},
        )
        asset_name_row = asset_name_result.first()
        asset_name = (
            asset_name_row._mapping["name"]
            if asset_name_row is not None
            else "asset"
        )

        description = body.description.strip()
        existing = await find_active_review_for_asset(session, body.asset_id)
        if existing is None:
            latest = await find_latest_review_for_asset(session, body.asset_id)
            if latest is not None and latest.state == "closed":
                existing = latest

        if existing is not None:
            await update_review_supervisor_report(
                session,
                existing.id,
                raised_by_worker_id=body.raised_by_worker_id,
                tagged_worker_ids=tagged_worker_ids,
                report_description=description,
                report_concern_type=concern_type,
            )
            review = existing
            if review.state in ("decided", "closed"):
                review = await transition_review(
                    session,
                    review.id,
                    ReviewEvent.REOPEN,
                    "api:supervisor_report",
                    extra_payload={
                        "reason": "Supervisor raised concern on existing review",
                        "concern_type": concern_type,
                    },
                )
                review = await transition_review(
                    session,
                    review.id,
                    ReviewEvent.TRIGGER_ASSESSMENT,
                    "api:supervisor_report",
                )
            elif review.state in ("opened", "pending_decision", "reopened"):
                review = await transition_review(
                    session,
                    review.id,
                    ReviewEvent.TRIGGER_ASSESSMENT,
                    "api:supervisor_report",
                )
            # assessing / escalated: attach report only; leave state alone
        else:
            review = await create_review(
                session,
                asset_id=body.asset_id,
                triggered_by="supervisor_reported",
                owner_id=owner_id,
                actor="api:supervisor_report",
                origin="supervisor",
                raised_by_worker_id=body.raised_by_worker_id,
                tagged_worker_ids=tagged_worker_ids,
                report_description=description,
                report_concern_type=concern_type,
            )
            review = await transition_review(
                session,
                review.id,
                ReviewEvent.TRIGGER_ASSESSMENT,
                "api:supervisor_report",
            )

        from app.notifications.service import notify_supervisor_report_tagged

        await notify_supervisor_report_tagged(
            session,
            review_id=review.id,
            recipient_ids=tagged_worker_ids,
            reporter_name=reported_by_name,
            asset_name=asset_name,
        )
        await session.commit()
        return review

    # Default: manual review created via existing operator path.
    review = await create_review(
        session,
        asset_id=body.asset_id,
        triggered_by=body.triggered_by,
        owner_id=owner_id,
        actor="api:manual",
    )
    return await transition_review(
        session,
        review.id,
        ReviewEvent.TRIGGER_ASSESSMENT,
        "api:manual",
    )


@router.get("", response_model=list[Review])
async def get_reviews(
    state: str | None = Query(default=None),
    asset_id: UUID | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> list[Review]:
    return await list_reviews(session, state=state, asset_id=asset_id)


@router.get("/raised-by-me", response_model=list[SharedReviewOut])
async def get_raised_reviews(
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> list[SharedReviewOut]:
    if actor.kind != "worker":
        raise HTTPException(status_code=403, detail="Workers only")
    return await list_raised_reviews_for_worker(session, worker_id=actor.id)


@router.get("/shared-with-me", response_model=list[SharedReviewOut])
async def get_shared_reviews(
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> list[SharedReviewOut]:
    if actor.kind != "worker":
        raise HTTPException(status_code=403, detail="Workers only")
    return await list_shared_reviews_for_worker(session, worker_id=actor.id)


@router.get("/{review_id}", response_model=ReviewDetailOut)
async def get_review_by_id(
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ReviewDetailOut:
    detail = await get_review_detail(session, review_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return detail


@router.get(
    "/{review_id}/comments",
    response_model=list[ReviewCommentOut],
)
async def get_review_comments(
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[ReviewCommentOut]:
    return await list_review_comments(session, review_id=review_id)


@router.post(
    "/{review_id}/comments",
    response_model=ReviewCommentOut,
    status_code=201,
)
async def post_review_comment(
    review_id: UUID,
    body: ReviewCommentIn,
    session: AsyncSession = Depends(get_session),
    actor=Depends(get_current_actor),
) -> ReviewCommentOut:
    return await create_review_comment(
        session,
        review_id=review_id,
        author=actor,
        body=body.body,
        mentioned_worker_ids=body.mentioned_worker_ids,
    )


@router.get("/{review_id}/assessments", response_model=list[AssessmentOut])
async def get_review_assessments(
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    if await get_review(session, review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return await list_assessments(session, review_id)


@router.post("/{review_id}/assessments/retry", status_code=202)
async def retry_assessment(
    review_id: UUID,
    body: RetryIn | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    review = await get_review(session, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.state != "assessing":
        raise HTTPException(
            status_code=409,
            detail=f"Retry only allowed while assessing (current={review.state})",
        )
    provider = body.provider if body else None
    assessment_id = await enqueue_for_review(
        session, review, provider_override=provider
    )
    if assessment_id is None:
        raise HTTPException(
            status_code=409,
            detail="An assessment is already pending or generating",
        )
    return {
        "assessment_id": str(assessment_id),
        "review_id": str(review_id),
        "provider": provider or get_settings().ai_provider,
        "status": "pending",
    }


@router.post(
    "/{review_id}/assessments/manual",
    response_model=Assessment,
    status_code=201,
)
async def post_manual_assessment(
    review_id: UUID,
    body: ManualAssessmentIn,
    session: AsyncSession = Depends(get_session),
) -> Assessment:
    if await get_review(session, review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    try:
        return await create_manual_assessment(session, review_id, body)
    except IllegalTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{review_id}/escalate", response_model=Review)
async def escalate_review(
    review_id: UUID,
    body: EscalateIn,
    session: AsyncSession = Depends(get_session),
) -> Review:
    if await get_review(session, review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    try:
        return await transition_review(
            session,
            review_id,
            ReviewEvent.ESCALATE,
            "api:escalate",
            extra_payload={"reason": body.reason},
        )
    except IllegalTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{review_id}/de-escalate", response_model=Review)
async def de_escalate_review(
    review_id: UUID,
    body: EscalateIn | None = None,
    session: AsyncSession = Depends(get_session),
) -> Review:
    if await get_review(session, review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    try:
        return await transition_review(
            session,
            review_id,
            ReviewEvent.RESOLVE_ESCALATION,
            "api:de_escalate",
            extra_payload={"reason": (body.reason if body else "") or ""},
        )
    except IllegalTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{review_id}/reopen", response_model=Review)
async def reopen_review(
    review_id: UUID,
    body: ReopenIn,
    session: AsyncSession = Depends(get_session),
) -> Review:
    review = await get_review(session, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    try:
        await transition_review(
            session,
            review_id,
            ReviewEvent.REOPEN,
            "api:reopen",
            extra_payload={"reason": body.reason},
        )
        return await transition_review(
            session,
            review_id,
            ReviewEvent.TRIGGER_ASSESSMENT,
            "api:reopen",
        )
    except IllegalTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{review_id}/close", response_model=Review)
async def close_review(
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Review:
    if await get_review(session, review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    try:
        return await transition_review(
            session,
            review_id,
            ReviewEvent.CLOSE,
            "api:close",
        )
    except IllegalTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{review_id}/reports")
async def get_review_reports(
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    if await get_review(session, review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    from app.reports.service import list_reports_for_review

    return await list_reports_for_review(session, review_id)
