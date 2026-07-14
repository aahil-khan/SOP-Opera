from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessment.manual import create_manual_assessment, list_assessments
from app.assessment.orchestrator import enqueue_for_review
from app.assessment.schemas import AssessmentOut, RetryIn
from app.core.config import get_settings
from app.db.session import get_session
from app.reviews.repository import create_review, get_review, transition_review
from app.reviews.schemas import CreateReviewIn, EscalateIn, ReopenIn, ReviewDetailOut
from app.reviews.service import get_review_detail, list_reviews
from app.reviews.state_machine import IllegalTransitionError, ReviewEvent
from shared.python.schemas import Assessment, ManualAssessmentIn, Review

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post("", response_model=Review, status_code=201)
async def post_review(
    body: CreateReviewIn,
    session: AsyncSession = Depends(get_session),
) -> Review:
    owner_id = body.owner_id or UUID(get_settings().default_owner_user_id)
    from app.context.service import asset_exists

    if not await asset_exists(session, body.asset_id):
        raise HTTPException(status_code=404, detail="Asset not found")

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


@router.get("/{review_id}", response_model=ReviewDetailOut)
async def get_review_by_id(
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ReviewDetailOut:
    detail = await get_review_detail(session, review_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return detail


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
