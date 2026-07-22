from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import ActorMeOut
from app.realtime.connection_manager import manager
from app.tasks.schemas import (
    ReviewTaskOut,
    TaskAcknowledgeOut,
    TaskDoneIn,
    TaskDoneOut,
    TaskListOut,
    TaskSummaryOut,
)
from app.notifications.service import create_notification
from app.reviews.comments_service import create_review_comment

logger = logging.getLogger(__name__)


def _task_type_for_outcome(outcome: str) -> str:
    return "unblock" if outcome == "blocked" else "follow_up"


async def get_task_summary(
    session: AsyncSession,
    *,
    review_id: UUID,
) -> TaskSummaryOut:
    result = await session.execute(
        text(
            """
            SELECT status, COUNT(*)::int AS cnt
            FROM review_tasks
            WHERE review_id = CAST(:rid AS uuid)
            GROUP BY status
            """
        ),
        {"rid": str(review_id)},
    )
    counts = {row._mapping["status"]: row._mapping["cnt"] for row in result.fetchall()}
    open_count = counts.get("open", 0)
    ack_count = counts.get("acknowledged", 0)
    done_count = counts.get("done", 0)
    cancelled_count = counts.get("cancelled", 0)
    total = open_count + ack_count + done_count
    all_done = total == 0 or (open_count == 0 and ack_count == 0)
    return TaskSummaryOut(
        total=total,
        open=open_count,
        acknowledged=ack_count,
        done=done_count,
        cancelled=cancelled_count,
        all_done=all_done,
    )


async def cancel_open_tasks_for_review(
    session: AsyncSession,
    *,
    review_id: UUID,
    actor: str,
) -> list[UUID]:
    """Cancel outstanding HITL tasks when a review is reopened."""
    result = await session.execute(
        text(
            """
            UPDATE review_tasks
            SET status = 'cancelled'
            WHERE review_id = CAST(:rid AS uuid)
              AND status IN ('open', 'acknowledged')
            RETURNING id, assigned_worker_id
            """
        ),
        {"rid": str(review_id)},
    )
    rows = result.fetchall()
    if not rows:
        return []

    await session.commit()

    cancelled_ids: list[UUID] = []
    for row in rows:
        m = row._mapping
        task_id = m["id"]
        cancelled_ids.append(task_id)
        await manager.broadcast(
            "task.cancelled",
            {
                "task_id": str(task_id),
                "review_id": str(review_id),
                "status": "cancelled",
                "assigned_worker_id": str(m["assigned_worker_id"]),
                "actor": actor,
            },
        )
    return cancelled_ids


async def list_tasks_for_review(
    session: AsyncSession,
    *,
    review_id: UUID,
) -> list[ReviewTaskOut]:
    result = await session.execute(
        text(
            """
            SELECT
              t.id,
              t.assigned_worker_id,
              w.name AS assigned_worker_name,
              t.task_type,
              t.title,
              t.detail,
              t.status,
              t.created_at,
              t.acknowledged_at,
              t.done_at,
              t.done_note
            FROM review_tasks t
            LEFT JOIN workers w ON w.id = t.assigned_worker_id
            WHERE t.review_id = CAST(:rid AS uuid)
              AND t.status <> 'cancelled'
            ORDER BY
              CASE t.status
                WHEN 'open' THEN 0
                WHEN 'acknowledged' THEN 1
                ELSE 2
              END ASC,
              t.created_at ASC
            """
        ),
        {"rid": str(review_id)},
    )

    out: list[ReviewTaskOut] = []
    for row in result.fetchall():
        m = row._mapping
        out.append(
            ReviewTaskOut(
                id=m["id"],
                assigned_worker_id=m["assigned_worker_id"],
                assigned_worker_name=m["assigned_worker_name"],
                task_type=m["task_type"],
                title=m["title"],
                detail=m["detail"],
                status=m["status"],
                created_at=m["created_at"].isoformat()
                if hasattr(m["created_at"], "isoformat")
                else str(m["created_at"]),
                acknowledged_at=m["acknowledged_at"].isoformat()
                if m["acknowledged_at"] is not None
                else None,
                done_at=m["done_at"].isoformat() if m["done_at"] is not None else None,
                done_note=m["done_note"],
            )
        )
    return out


async def list_tasks(
    session: AsyncSession,
    *,
    assigned_worker_id: UUID,
    limit: int = 50,
) -> list[TaskListOut]:
    result = await session.execute(
        text(
            """
            SELECT
              t.id,
              t.review_id,
              t.decision_id,
              t.assigned_worker_id,
              t.task_type,
              t.title,
              t.detail,
              t.status,
              t.created_by,
              t.created_at,
              t.acknowledged_at,
              t.done_at,
              t.done_note,
              r.asset_id,
              r.state AS review_state,
              a.name AS asset_name,
              a.zone AS asset_zone,
              a.floor AS asset_floor,
              d.outcome AS decision_outcome,
              d.conditions AS decision_conditions,
              d.comments AS decision_comments,
              d.submitted_at AS decision_submitted_at,
              u.name AS decision_decided_by_name
            FROM review_tasks t
            JOIN reviews r ON r.id = t.review_id
            JOIN assets a ON a.id = r.asset_id
            LEFT JOIN decisions d ON d.id = t.decision_id
            LEFT JOIN users u ON u.id = d.decided_by
            WHERE t.assigned_worker_id = CAST(:wid AS uuid)
              AND t.status <> 'cancelled'
            ORDER BY
              CASE t.status
                WHEN 'open' THEN 0
                WHEN 'acknowledged' THEN 1
                ELSE 2
              END ASC,
              t.created_at DESC
            LIMIT :limit
            """
        ),
        {"wid": str(assigned_worker_id), "limit": max(1, min(limit, 200))},
    )

    out: list[TaskListOut] = []
    for row in result.fetchall():
        m = row._mapping
        out.append(
            TaskListOut(
                id=m["id"],
                review_id=m["review_id"],
                decision_id=m["decision_id"],
                assigned_worker_id=m["assigned_worker_id"],
                task_type=m["task_type"],
                title=m["title"],
                detail=m["detail"],
                status=m["status"],
                created_by=m["created_by"],
                created_at=m["created_at"].isoformat()
                if hasattr(m["created_at"], "isoformat")
                else str(m["created_at"]),
                acknowledged_at=m["acknowledged_at"].isoformat()
                if m["acknowledged_at"] is not None
                else None,
                done_at=m["done_at"].isoformat() if m["done_at"] is not None else None,
                done_note=m["done_note"],
                review_state=m["review_state"],
                asset_id=m["asset_id"],
                asset_name=m["asset_name"],
                asset_zone=m["asset_zone"],
                asset_floor=m["asset_floor"],
                decision_outcome=m["decision_outcome"],
                decision_conditions=m["decision_conditions"],
                decision_comments=m["decision_comments"],
                decision_submitted_at=m["decision_submitted_at"].isoformat()
                if m["decision_submitted_at"] is not None
                else None,
                decision_decided_by_name=m["decision_decided_by_name"],
            )
        )
    return out


async def _fetch_task_for_update(
    session: AsyncSession, *, task_id: UUID
) -> dict:
    result = await session.execute(
        text(
            """
            SELECT id, review_id, task_type, status, assigned_worker_id
            FROM review_tasks
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": str(task_id)},
    )
    row = result.first()
    if row is None:
        raise LookupError(f"Task {task_id} not found")
    return dict(row._mapping)


async def acknowledge_task(
    session: AsyncSession,
    *,
    task_id: UUID,
    actor: ActorMeOut,
) -> TaskAcknowledgeOut:
    task = await _fetch_task_for_update(session, task_id=task_id)
    if task["status"] != "open":
        raise ValueError(f"Only open tasks can be acknowledged (current={task['status']})")

    result = await session.execute(
        text(
            """
            UPDATE review_tasks
            SET status = 'acknowledged',
                acknowledged_at = now()
            WHERE id = CAST(:id AS uuid)
            RETURNING id, status, acknowledged_at
            """
        ),
        {"id": str(task_id)},
    )
    m = result.one()._mapping
    await session.commit()

    await manager.broadcast(
        "task.acknowledged",
        {
            "task_id": str(task_id),
            "review_id": str(task["review_id"]),
            "status": m["status"],
            "acknowledged_at": m["acknowledged_at"].isoformat()
            if hasattr(m["acknowledged_at"], "isoformat")
            else str(m["acknowledged_at"]),
            "actor": actor.name,
        },
    )

    return TaskAcknowledgeOut(
        id=m["id"],
        status=m["status"],
        acknowledged_at=m["acknowledged_at"].isoformat()
        if hasattr(m["acknowledged_at"], "isoformat")
        else str(m["acknowledged_at"]),
    )


async def complete_task(
    session: AsyncSession,
    *,
    task_id: UUID,
    body: TaskDoneIn,
    actor: ActorMeOut,
) -> TaskDoneOut:
    task = await _fetch_task_for_update(session, task_id=task_id)
    if task["status"] == "done":
        raise ValueError("Task already completed")

    result = await session.execute(
        text(
            """
            UPDATE review_tasks
            SET status = 'done',
                done_at = now(),
                done_note = :note
            WHERE id = CAST(:id AS uuid)
            RETURNING id, status, done_at, done_note
            """
        ),
        {"id": str(task_id), "note": body.done_note or None},
    )
    m = result.one()._mapping
    await session.commit()

    review_id = task["review_id"]
    if task["task_type"] == "unblock":
        from app.simulator.engine import demo_controller

        demo_controller.clear_inactive_lock_for_review(review_id)

    # Done note becomes an entry in the review comment thread.
    if body.done_note and body.done_note.strip():
        await create_review_comment(
            session,
            review_id=review_id,
            author=actor,
            body=body.done_note.strip(),
            mentioned_worker_ids=[],
        )

        # For unblock completion, notify the operator (review owner).
        try:
            owner_res = await session.execute(
                text(
                    """
                    SELECT owner_id
                    FROM reviews
                    WHERE id = CAST(:rid AS uuid)
                    """
                ),
                {"rid": str(review_id)},
            )
            owner_row = owner_res.first()
            if owner_row is not None:
                await create_notification(
                    session,
                    review_id=review_id,
                    event_type="task.unblocked",
                    summary=f"Task completed · {actor.name}",
                    recipient_ids=[owner_row._mapping["owner_id"]],
                )
                await session.commit()
        except Exception as exc:  # noqa: BLE001
            logger.debug("task notify operator failed: %s", exc)

    await manager.broadcast(
        "task.completed",
        {
            "task_id": str(task_id),
            "review_id": str(review_id),
            "status": m["status"],
            "done_at": m["done_at"].isoformat()
            if hasattr(m["done_at"], "isoformat")
            else str(m["done_at"]),
            "done_note": body.done_note or None,
            "actor": actor.name,
        },
    )

    return TaskDoneOut(
        id=m["id"],
        status=m["status"],
        done_at=m["done_at"].isoformat()
        if hasattr(m["done_at"], "isoformat")
        else str(m["done_at"]),
        done_note=m["done_note"],
    )


def _task_detail_for_decision(
    *,
    task_type: str,
    outcome: str,
    conditions: str | None,
    accepted_action_texts: list[str],
) -> str:
    lines: list[str] = []
    if task_type == "unblock":
        lines.append(
            "Clear the physical lockout and make the asset safe to restart."
        )
    if accepted_action_texts:
        lines.extend(accepted_action_texts)
    if conditions:
        lines.append(f"Conditions: {conditions}")
    if lines:
        return "\n".join(lines)
    return f"Decision outcome: {outcome.replace('_', ' ')}"


async def _accepted_recommendation_texts(
    session: AsyncSession,
    *,
    assessment_id: UUID,
    recommendation_dispositions: dict[str, str],
) -> list[str]:
    result = await session.execute(
        text(
            """
            SELECT id, text
            FROM recommendations
            WHERE assessment_id = CAST(:aid AS uuid)
            ORDER BY id ASC
            """
        ),
        {"aid": str(assessment_id)},
    )
    texts: list[str] = []
    for row in result.fetchall():
        m = row._mapping
        rec_id = str(m["id"])
        if recommendation_dispositions.get(rec_id, "accepted") == "rejected":
            continue
        text_val = str(m["text"] or "").strip()
        if text_val:
            texts.append(text_val)
    return texts


async def create_tasks_for_decision(
    session: AsyncSession,
    *,
    review_id: UUID,
    decision_id: UUID,
    assigned_worker_ids: list[UUID],
    outcome: str,
    actor: str,
    assessment_id: UUID | None = None,
    recommendation_dispositions: dict[str, str] | None = None,
    conditions: str | None = None,
) -> list[UUID]:
    if not assigned_worker_ids:
        return []

    task_type = _task_type_for_outcome(outcome)
    title = (
        "Unblock machine (HITL)"
        if task_type == "unblock"
        else "Follow up actions (HITL)"
    )
    accepted_texts: list[str] = []
    if assessment_id is not None:
        accepted_texts = await _accepted_recommendation_texts(
            session,
            assessment_id=assessment_id,
            recommendation_dispositions=recommendation_dispositions or {},
        )
    detail = _task_detail_for_decision(
        task_type=task_type,
        outcome=outcome,
        conditions=conditions,
        accepted_action_texts=accepted_texts,
    )

    task_pairs: list[tuple[UUID, UUID]] = []
    for wid in sorted({UUID(str(x)) for x in assigned_worker_ids}, key=lambda u: str(u)):
        result = await session.execute(
            text(
                """
                INSERT INTO review_tasks (
                  review_id, decision_id,
                  assigned_worker_id, task_type,
                  title, detail,
                  created_by
                )
                VALUES (
                  CAST(:rid AS uuid),
                  CAST(:did AS uuid),
                  CAST(:wid AS uuid),
                  :ttype,
                  :title,
                  :detail,
                  :actor
                )
                RETURNING id
                """
            ),
            {
                "rid": str(review_id),
                "did": str(decision_id),
                "wid": wid,
                "ttype": task_type,
                "title": title,
                "detail": detail,
                "actor": actor,
            },
        )
        task_id = result.one()._mapping["id"]
        task_pairs.append((task_id, wid))

    await session.commit()

    for task_id, wid in task_pairs:
        await manager.broadcast(
            "task.created",
            {
                "task_id": str(task_id),
                "review_id": str(review_id),
                "decision_id": str(decision_id),
                "task_type": task_type,
                "assigned_worker_id": str(wid),
            },
        )

    return [task_id for task_id, _wid in task_pairs]

