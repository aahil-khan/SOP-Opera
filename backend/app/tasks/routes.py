from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import ActorMeOut
from app.auth.routes import get_current_actor
from app.db.session import get_session
from app.tasks.schemas import TaskDoneIn, TaskDoneOut, TaskListOut, TaskAcknowledgeOut
from app.tasks.service import acknowledge_task, complete_task, list_tasks

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskListOut])
async def get_tasks(
    assigned_worker_id: UUID = Query(...),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
) -> list[TaskListOut]:
    return await list_tasks(
        session, assigned_worker_id=assigned_worker_id, limit=limit
    )


@router.post(
    "/{task_id}/acknowledge", response_model=TaskAcknowledgeOut, status_code=200
)
async def post_acknowledge(
    task_id: UUID,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> TaskAcknowledgeOut:
    try:
        return await acknowledge_task(session, task_id=task_id, actor=actor)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/{task_id}/done", response_model=TaskDoneOut, status_code=200
)
async def post_done(
    task_id: UUID,
    body: TaskDoneIn,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> TaskDoneOut:
    try:
        return await complete_task(
            session, task_id=task_id, body=body, actor=actor
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

