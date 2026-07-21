"""Deterministic in-app notifications — no LLM summarization."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.realtime.connection_manager import manager

logger = logging.getLogger(__name__)


async def create_notification(
    session: AsyncSession,
    *,
    review_id: UUID | None,
    event_type: str,
    summary: str,
    recipient_ids: list[UUID],
) -> UUID:
    result = await session.execute(
        text(
            """
            INSERT INTO notifications (review_id, event_type, summary, recipient_ids)
            VALUES (
                CAST(:review_id AS uuid),
                :event_type,
                :summary,
                CAST(:recipient_ids AS uuid[])
            )
            RETURNING id, created_at
            """
        ),
        {
            "review_id": str(review_id) if review_id else None,
            "event_type": event_type,
            "summary": summary,
            "recipient_ids": [str(r) for r in recipient_ids],
        },
    )
    row = result.one()._mapping
    notification_id = row["id"]
    await manager.broadcast(
        "notification.created",
        {
            "id": str(notification_id),
            "review_id": str(review_id) if review_id else None,
            "event_type": event_type,
            "summary": summary,
            "recipient_ids": [str(r) for r in recipient_ids],
            "created_at": row["created_at"].isoformat(),
        },
    )
    return notification_id


async def notify_review_opened(
    session: AsyncSession,
    *,
    review_id: UUID,
    owner_id: UUID,
    triggered_by: str,
) -> None:
    await create_notification(
        session,
        review_id=review_id,
        event_type="review.opened",
        summary=f"New review started · {triggered_by}",
        recipient_ids=[owner_id],
    )


async def notify_assessment_completed(
    session: AsyncSession,
    *,
    review_id: UUID,
    owner_id: UUID,
    risk_level: str,
    sensor_critical: bool = False,
) -> None:
    if sensor_critical:
        summary = "Critical sensor threshold — immediate attention required"
    elif risk_level == "blocking":
        summary = "Blocking risk — needs a decision"
    elif risk_level == "elevated":
        summary = "Elevated risk assessment ready"
    else:
        return
    await create_notification(
        session,
        review_id=review_id,
        event_type="assessment.completed",
        summary=summary,
        recipient_ids=[owner_id],
    )


async def notify_assessment_failed(
    session: AsyncSession,
    *,
    review_id: UUID,
    owner_id: UUID,
) -> None:
    await create_notification(
        session,
        review_id=review_id,
        event_type="assessment.failed",
        summary="Assessment failed — submit a manual assessment",
        recipient_ids=[owner_id],
    )


async def notify_decision_submitted(
    session: AsyncSession,
    *,
    review_id: UUID,
    owner_id: UUID,
    outcome: str,
) -> None:
    await create_notification(
        session,
        review_id=review_id,
        event_type="decision.submitted",
        summary=f"Decision recorded · {outcome.replace('_', ' ')}",
        recipient_ids=[owner_id],
    )


async def notify_review_closed(
    session: AsyncSession,
    *,
    review_id: UUID,
    owner_id: UUID,
) -> None:
    await create_notification(
        session,
        review_id=review_id,
        event_type="review.closed",
        summary="Review closed · report ready",
        recipient_ids=[owner_id],
    )


async def notify_review_escalated(
    session: AsyncSession,
    *,
    review_id: UUID,
    owner_id: UUID,
    reason: str | None = None,
) -> None:
    suffix = f" — {reason}" if reason else ""
    await create_notification(
        session,
        review_id=review_id,
        event_type="review.escalated",
        summary=f"Review escalated{suffix}",
        recipient_ids=[owner_id],
    )


async def notify_review_de_escalated(
    session: AsyncSession,
    *,
    review_id: UUID,
    owner_id: UUID,
    reason: str | None = None,
) -> None:
    suffix = f" — {reason}" if reason else ""
    await create_notification(
        session,
        review_id=review_id,
        event_type="review.de_escalated",
        summary=f"Escalation resolved{suffix}",
        recipient_ids=[owner_id],
    )


async def notify_supervisor_report_tagged(
    session: AsyncSession,
    *,
    review_id: UUID,
    recipient_ids: list[UUID],
    reporter_name: str,
    asset_name: str,
) -> None:
    if not recipient_ids:
        return
    await create_notification(
        session,
        review_id=review_id,
        event_type="supervisor_report.tagged",
        summary=f"{reporter_name} shared a floor issue on {asset_name}",
        recipient_ids=recipient_ids,
    )


async def list_notifications(
    session: AsyncSession, *, limit: int = 50
) -> list[dict]:
    result = await session.execute(
        text(
            """
            SELECT id, review_id, event_type, summary, recipient_ids, created_at
            FROM notifications
            ORDER BY created_at DESC
            LIMIT :limit
            """
        ),
        {"limit": max(1, min(limit, 200))},
    )
    out: list[dict] = []
    for row in result.fetchall():
        m = row._mapping
        out.append(
            {
                "id": str(m["id"]),
                "review_id": str(m["review_id"]) if m["review_id"] else None,
                "event_type": m["event_type"],
                "summary": m["summary"],
                "recipient_ids": [str(x) for x in (m["recipient_ids"] or [])],
                "created_at": m["created_at"].isoformat()
                if hasattr(m["created_at"], "isoformat")
                else m["created_at"],
            }
        )
    return out
