from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.realtime.connection_manager import manager
from app.reviews.state_machine import ReviewEvent, next_state
from shared.python.schemas import Review

logger = logging.getLogger(__name__)


def _row_to_review(row: object) -> Review:
    m = row._mapping  # type: ignore[attr-defined]
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


async def get_review(session: AsyncSession, review_id: UUID) -> Review | None:
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
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": str(review_id)},
    )
    row = result.first()
    return _row_to_review(row) if row else None


async def create_review(
    session: AsyncSession,
    *,
    asset_id: UUID,
    triggered_by: str,
    owner_id: UUID,
    actor: str,
    origin: str = "system",
    raised_by_worker_id: UUID | None = None,
    tagged_worker_ids: list[UUID] | None = None,
    report_description: str | None = None,
    report_concern_type: str | None = None,
) -> Review:
    """Insert a review in `opened`. Audits and broadcasts. Only writer of new review rows."""
    tagged = [str(w) for w in (tagged_worker_ids or [])]
    result = await session.execute(
        text(
            """
            INSERT INTO reviews (
                asset_id, state, owner_id, triggered_by,
                origin, raised_by_worker_id, tagged_worker_ids,
                report_description, report_concern_type
            )
            VALUES (
                CAST(:asset_id AS uuid),
                'opened',
                CAST(:owner_id AS uuid),
                :triggered_by,
                :origin,
                :raised_by_worker_id,
                CAST(:tagged_worker_ids AS uuid[]),
                :report_description,
                :report_concern_type
            )
            RETURNING id,
                      asset_id,
                      state,
                      owner_id,
                      triggered_by,
                      origin,
                      raised_by_worker_id,
                      created_at
            """
        ),
        {
            "asset_id": str(asset_id),
            "owner_id": str(owner_id),
            "triggered_by": triggered_by,
            "origin": origin,
            "raised_by_worker_id": str(raised_by_worker_id)
            if raised_by_worker_id is not None
            else None,
            "tagged_worker_ids": tagged,
            "report_description": report_description,
            "report_concern_type": report_concern_type,
        },
    )
    review = _row_to_review(result.one())
    await record_audit(
        session,
        entity_type="review",
        entity_id=review.id,
        event_type="review.opened",
        actor=actor,
        payload={
            "asset_id": str(asset_id),
            "triggered_by": triggered_by,
            "owner_id": str(owner_id),
            "state": "opened",
        },
    )
    from app.notifications.service import notify_review_opened

    await notify_review_opened(
        session,
        review_id=review.id,
        owner_id=owner_id,
        triggered_by=triggered_by,
    )
    await session.commit()
    await manager.broadcast(
        "review.status_changed",
        {
            "review_id": str(review.id),
            "asset_id": str(review.asset_id),
            "state": review.state,
            "previous_state": None,
            "event": "opened",
        },
    )
    return review


async def update_review_supervisor_report(
    session: AsyncSession,
    review_id: UUID,
    *,
    raised_by_worker_id: UUID,
    tagged_worker_ids: list[UUID],
    report_description: str,
    report_concern_type: str,
) -> None:
    """Attach / refresh supervisor floor-report fields on an existing review."""
    await session.execute(
        text(
            """
            UPDATE reviews
            SET origin = 'supervisor',
                raised_by_worker_id = CAST(:wid AS uuid),
                tagged_worker_ids = CAST(:tagged AS uuid[]),
                report_description = :description,
                report_concern_type = :concern
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {
            "id": str(review_id),
            "wid": str(raised_by_worker_id),
            "tagged": [str(w) for w in tagged_worker_ids],
            "description": report_description,
            "concern": report_concern_type,
        },
    )
    await session.commit()


async def transition_review(
    session: AsyncSession,
    review_id: UUID,
    event: ReviewEvent,
    actor: str,
    *,
    extra_payload: dict | None = None,
) -> Review:
    """The only legal writer of reviews.state."""
    review = await get_review(session, review_id)
    if review is None:
        raise LookupError(f"Review {review_id} not found")

    previous = review.state
    new_state = next_state(previous, event)  # type: ignore[arg-type]

    closed_sql = ""
    params: dict = {
        "id": str(review_id),
        "state": new_state,
    }
    if new_state == "closed":
        closed_sql = ", closed_at = now()"
    elif previous == "closed" and new_state == "reopened":
        closed_sql = ", closed_at = NULL"

    result = await session.execute(
        text(
            f"""
            UPDATE reviews
            SET state = :state{closed_sql}
            WHERE id = CAST(:id AS uuid)
            RETURNING id,
                      asset_id,
                      state,
                      owner_id,
                      triggered_by,
                      origin,
                      raised_by_worker_id,
                      created_at
            """
        ),
        params,
    )
    updated = _row_to_review(result.one())

    audit_payload = {
        "previous_state": previous,
        "new_state": new_state,
        "event": event.value,
        **(extra_payload or {}),
    }
    await record_audit(
        session,
        entity_type="review",
        entity_id=updated.id,
        event_type=f"review.{event.value}",
        actor=actor,
        payload=audit_payload,
    )

    if event == ReviewEvent.RISK_RETURNED:
        from app.notifications.service import notify_review_reopened_for_risk

        await notify_review_reopened_for_risk(
            session,
            review_id=updated.id,
            owner_id=updated.owner_id,
            reason=(extra_payload or {}).get("reason")
            or "Risk returned since prior decision — new assessment required",
        )
    elif event == ReviewEvent.SUBMIT_DECISION:
        from app.notifications.service import notify_decision_submitted

        await notify_decision_submitted(
            session,
            review_id=updated.id,
            owner_id=updated.owner_id,
            outcome=str((extra_payload or {}).get("outcome") or "unknown"),
        )

    # Freeze the closure report inside this transaction, not after it. Generating
    # it post-commit meant a failure here left a `closed` review with no report
    # and nothing to retry; now the close either happens with its packet or does
    # not happen at all.
    report_id: UUID | None = None
    report_seq: int | None = None
    promoted_incident_id: UUID | None = None
    if new_state == "closed":
        from app.reports.service import freeze_report_on_closure

        report_id, report_seq, promoted_incident_id = await freeze_report_on_closure(
            session, updated, actor=actor
        )

    await session.commit()
    await manager.broadcast(
        "review.status_changed",
        {
            "review_id": str(updated.id),
            "asset_id": str(updated.asset_id),
            "state": updated.state,
            "previous_state": previous,
            "event": event.value,
        },
    )
    if new_state == "assessing":
        # Deferred import avoids circular deps (orchestrator → transition_review).
        from app.assessment.orchestrator import enqueue_for_review

        await enqueue_for_review(session, updated)
    if new_state == "reopened":
        from app.tasks.service import cancel_open_tasks_for_review

        await cancel_open_tasks_for_review(
            session,
            review_id=updated.id,
            actor=actor,
        )
    if new_state == "closed":
        from app.simulator.engine import demo_controller

        demo_controller.mark_review_closed(
            review_id=updated.id, asset_id=updated.asset_id
        )
        # Announced only once the freeze is durable, and always after
        # review.status_changed so the UI sees the states in order.
        if report_id is not None and report_seq is not None:
            from app.reports.service import broadcast_report_generated

            await broadcast_report_generated(
                report_id=report_id,
                review_id=updated.id,
                closure_event_seq=report_seq,
            )
        # Chunk indexing uses the vector pool (separate from this txn) and must
        # only run once the incidents row is committed.
        if promoted_incident_id is not None:
            from app.incidents.service import index_promoted_incident

            try:
                await index_promoted_incident(promoted_incident_id)
            except Exception:  # noqa: BLE001 — report freeze already succeeded
                logger.exception(
                    "failed to index promoted incident %s after close of %s",
                    promoted_incident_id,
                    updated.id,
                )
    return updated
