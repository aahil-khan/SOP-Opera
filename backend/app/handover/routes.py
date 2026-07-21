from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.routes import get_current_actor, get_current_actor_from_request
from app.auth.schemas import ActorMeOut
from app.db.session import get_session
from app.handover import service
from app.handover.schemas import (
    HandoverAckIn,
    HandoverDraftIn,
    HandoverGapOut,
    HandoverMetricsOut,
    HandoverNoteIn,
    HandoverOut,
)
from fastapi import Request

router = APIRouter(prefix="/handover", tags=["handover"])


@router.get("/current", response_model=HandoverOut | None)
async def get_current(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> HandoverOut | None:
    # Readable without a signed-in actor; `viewer_role` falls back to observer.
    actor = get_current_actor_from_request(request)
    return await service.get_current(session, actor=actor)


@router.get("/gaps", response_model=list[HandoverGapOut])
async def get_gaps(
    session: AsyncSession = Depends(get_session),
) -> list[HandoverGapOut]:
    return await service.get_gaps(session)


@router.get("/metrics", response_model=HandoverMetricsOut)
async def get_metrics(
    session: AsyncSession = Depends(get_session),
) -> HandoverMetricsOut:
    return await service.get_metrics(session)


@router.post("/draft", response_model=HandoverOut, status_code=201)
async def post_draft(
    body: HandoverDraftIn,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> HandoverOut:
    return await _guard(
        service.open_draft(
            session,
            actor=actor,
            incoming_actor_id=body.incoming_actor_id,
            window_hours=body.window_hours,
        )
    )


@router.post("/{handover_id}/notes", response_model=HandoverOut, status_code=201)
async def post_note(
    handover_id: UUID,
    body: HandoverNoteIn,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> HandoverOut:
    return await _guard(
        service.add_note(
            session,
            handover_id=handover_id,
            actor=actor,
            title=body.title,
            detail=body.detail,
            requires_ack=body.requires_ack,
        )
    )


@router.delete("/{handover_id}/items/{item_id}", response_model=HandoverOut)
async def delete_item(
    handover_id: UUID,
    item_id: UUID,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> HandoverOut:
    return await _guard(
        service.remove_item(
            session, handover_id=handover_id, item_id=item_id, actor=actor
        )
    )


@router.post("/{handover_id}/issue", response_model=HandoverOut)
async def post_issue(
    handover_id: UUID,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> HandoverOut:
    return await _guard(
        service.issue(session, handover_id=handover_id, actor=actor)
    )


@router.post("/{handover_id}/items/{item_id}/ack", response_model=HandoverOut)
async def post_ack(
    handover_id: UUID,
    item_id: UUID,
    body: HandoverAckIn,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> HandoverOut:
    return await _guard(
        service.acknowledge_item(
            session,
            handover_id=handover_id,
            item_id=item_id,
            ack_state=body.ack_state,
            note=body.note,
            actor=actor,
        )
    )


@router.post("/{handover_id}/accept", response_model=HandoverOut)
async def post_accept(
    handover_id: UUID,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> HandoverOut:
    return await _guard(
        service.accept(session, handover_id=handover_id, actor=actor)
    )


async def _guard(awaitable):  # type: ignore[no-untyped-def]
    """404 for unknown ids, 409 for an action illegal in the current state."""
    try:
        return await awaitable
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except service.HandoverError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
