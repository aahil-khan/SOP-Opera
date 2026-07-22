"""Decision HTTP routes — nested under /reviews/{id}/decisions."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.routes import get_current_actor_from_request
from app.auth.schemas import ActorMeOut
from app.core.config import get_settings
from app.decisions.schemas import DecisionIn
from app.decisions.service import DecisionError, submit_decision
from app.db.session import get_session
from app.reviews.repository import get_review
from shared.python.schemas import Decision

router = APIRouter(prefix="/reviews", tags=["decisions"])


def _decision_actor(request: Request) -> ActorMeOut | None:
    """Prefer the logged-in actor; tests / unauthenticated posts may omit the cookie."""
    return get_current_actor_from_request(request)


@router.post("/{review_id}/decisions", response_model=Decision, status_code=201)
async def post_decision(
    review_id: UUID,
    body: DecisionIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> Decision:
    if await get_review(session, review_id) is None:
        raise HTTPException(status_code=404, detail="Review not found")
    actor = _decision_actor(request)
    if actor is None:
        # Match submit_decision's decided_by fallback for unauthenticated API clients.
        from sqlalchemy import text

        owner_id = UUID(get_settings().default_owner_user_id)
        row = (
            await session.execute(
                text("SELECT id, name, role FROM users WHERE id = CAST(:id AS uuid)"),
                {"id": str(owner_id)},
            )
        ).first()
        if row is None:
            raise HTTPException(status_code=401, detail="Not authenticated")
        m = row._mapping
        actor = ActorMeOut(
            id=m["id"],
            kind="user",
            name=m["name"],
            role=m["role"],
            owned_zones=[],
        )
    try:
        return await submit_decision(session, review_id, body, actor=actor)
    except DecisionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
