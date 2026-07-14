from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.realtime.connection_manager import manager
from app.reviews.state_machine import ReviewEvent, next_state
from shared.python.schemas import Review


def _row_to_review(row: object) -> Review:
    m = row._mapping  # type: ignore[attr-defined]
    return Review(
        id=m["id"],
        asset_id=m["asset_id"],
        state=m["state"],
        owner_id=m["owner_id"],
        triggered_by=m["triggered_by"],
        created_at=m["created_at"],
    )


async def get_review(session: AsyncSession, review_id: UUID) -> Review | None:
    result = await session.execute(
        text(
            """
            SELECT id, asset_id, state, owner_id, triggered_by, created_at
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
) -> Review:
    """Insert a review in `opened`. Audits and broadcasts. Only writer of new review rows."""
    result = await session.execute(
        text(
            """
            INSERT INTO reviews (asset_id, state, owner_id, triggered_by)
            VALUES (
                CAST(:asset_id AS uuid),
                'opened',
                CAST(:owner_id AS uuid),
                :triggered_by
            )
            RETURNING id, asset_id, state, owner_id, triggered_by, created_at
            """
        ),
        {
            "asset_id": str(asset_id),
            "owner_id": str(owner_id),
            "triggered_by": triggered_by,
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
            RETURNING id, asset_id, state, owner_id, triggered_by, created_at
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
    return updated
