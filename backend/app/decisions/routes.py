"""Decision HTTP routes — nested under /reviews/{id}/decisions."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.decisions.schemas import DecisionIn
from app.decisions.service import DecisionError, submit_decision
from app.db.session import get_session
from app.reviews.repository import get_review
from shared.python.schemas import Decision

router = APIRouter(prefix="/reviews", tags=["decisions"])


@router.post("/{review_id}/decisions", response_model=Decision, status_code=201)
async def post_decision(
    review_id: UUID,
    body: DecisionIn,
    session: AsyncSession = Depends(get_session),
) -> Decision:
    if await get_review(session, review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    try:
        return await submit_decision(session, review_id, body)
    except DecisionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
