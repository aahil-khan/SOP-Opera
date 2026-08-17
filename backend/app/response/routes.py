from __future__ import annotations

import os
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.routes import get_current_actor
from app.auth.schemas import ActorMeOut
from app.core.config import get_settings
from app.db.session import get_session
from app.response import repository as repo
from app.response.dispatcher import dispatcher
from app.response.envelope import ACTION_REGISTRY
from app.response.schemas import (
    ActionOut,
    DeviceOut,
    PageOut,
    ResponseConfigIn,
    ResponseConfigOut,
    RevokeIn,
)
from app.response.service import (
    abort_action,
    acknowledge_page,
    revoke_action,
)

router = APIRouter(prefix="/response", tags=["response"])


def _to_action(row: dict[str, Any], pages: list[dict[str, Any]]) -> ActionOut:
    spec = ACTION_REGISTRY.get(row["action_kind"])
    return ActionOut(
        **{k: row.get(k) for k in ActionOut.model_fields if k in row},
        label=spec.label if spec else row["action_kind"],
        pages=[PageOut(**p) for p in pages],
    )


async def _actions_with_pages(
    session: AsyncSession, rows: list[dict[str, Any]]
) -> list[ActionOut]:
    page_rows = await repo.pages_for_actions(session, [r["id"] for r in rows])
    by_action: dict[UUID, list[dict[str, Any]]] = {}
    for p in page_rows:
        by_action.setdefault(p["action_id"], []).append(p)
    return [_to_action(r, by_action.get(r["id"], [])) for r in rows]


@router.get("/active", response_model=list[ActionOut])
async def get_active(
    session: AsyncSession = Depends(get_session),
) -> list[ActionOut]:
    """
    Rail contents, plant-wide.

    Includes refused actions on purpose — a Tier 3 refusal is evidence the
    envelope is a gate, so it is shown rather than hidden.
    """
    rows = await repo.list_active_actions(session)
    return await _actions_with_pages(session, rows)


@router.get("/devices", response_model=list[DeviceOut])
async def get_devices(
    session: AsyncSession = Depends(get_session),
) -> list[DeviceOut]:
    return [DeviceOut(**d) for d in await repo.list_devices(session)]


@router.get("/reviews/{review_id}/actions", response_model=list[ActionOut])
async def get_actions_for_review(
    review_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> list[ActionOut]:
    rows = await repo.list_actions_for_review(session, review_id)
    return await _actions_with_pages(session, rows)


@router.post("/actions/{action_id}/abort", response_model=ActionOut)
async def post_abort(
    action_id: UUID,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> ActionOut:
    """Cancel an action during its arming window."""
    row = await abort_action(session, action_id, actor=actor.name)
    if row is None:
        raise HTTPException(
            status_code=409,
            detail="Action is no longer armed — it already executed or ended",
        )
    await session.commit()
    fresh = await repo.get_action(session, action_id)
    return _to_action(fresh or row, [])


@router.post("/actions/{action_id}/revoke", response_model=ActionOut)
async def post_revoke(
    action_id: UUID,
    body: RevokeIn,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> ActionOut:
    """Undo an active action; the device reverts to its fail-safe state."""
    row = await revoke_action(
        session, action_id, actor=actor.name, reason=body.reason
    )
    if row is None:
        raise HTTPException(
            status_code=409, detail="Action is not revocable in its current state"
        )
    await session.commit()
    fresh = await repo.get_action(session, action_id)
    return _to_action(fresh or row, [])


@router.post("/pages/{page_id}/ack", response_model=PageOut)
async def post_page_ack(
    page_id: UUID,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> PageOut:
    """
    Acknowledge a page. Always a human act — never performed by the system.
    """
    row = await acknowledge_page(session, page_id, actor=actor.name)
    if row is None:
        raise HTTPException(
            status_code=409, detail="Page already acknowledged or escalated"
        )
    await session.commit()
    return PageOut(
        id=row["id"],
        action_id=row["action_id"],
        role=row["role"],
        zone=row["zone"],
        channel=row["channel"],
        escalation_order=row["escalation_order"],
        status="acknowledged",
        dispatched_at=row.get("dispatched_at") or row["acknowledged_at"],
        acknowledged_at=row["acknowledged_at"],
        acknowledged_by=row["acknowledged_by"],
    )


@router.get("/config", response_model=ResponseConfigOut)
async def get_response_config() -> ResponseConfigOut:
    s = get_settings()
    return ResponseConfigOut(
        auto_enabled=s.response_auto_enabled,
        arm_window_seconds=s.response_arm_window_seconds,
        page_ack_timeout_seconds=s.response_page_ack_timeout_seconds,
        dispatcher=dispatcher.status(),
    )


@router.put("/config", response_model=ResponseConfigOut)
async def put_response_config(body: ResponseConfigIn) -> ResponseConfigOut:
    """
    The master arm switch — the rail's [pause all].

    Patches process env and clears the Settings cache, matching how
    `/api/config/thresholds` does in-process tuning. Does not rewrite .env.
    Paused, actions are still evaluated and shown as refused-because-paused, so
    the reasoning stays visible with nothing executing.
    """
    os.environ["RESPONSE_AUTO_ENABLED"] = "true" if body.auto_enabled else "false"
    get_settings.cache_clear()
    return await get_response_config()
