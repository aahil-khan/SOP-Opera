from __future__ import annotations

import logging
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import ActorMeOut
from app.notifications.service import create_notification
from app.realtime.connection_manager import manager

logger = logging.getLogger(__name__)


class ReviewCommentIn(BaseModel):
    body: str
    mentioned_worker_ids: list[UUID] = Field(default_factory=list)


class ReviewCommentOut(BaseModel):
    id: UUID
    review_id: UUID
    author_kind: str
    author_id: UUID
    author_name: str
    body: str
    mentioned_worker_ids: list[UUID]
    created_at: str


async def list_review_comments(
    session: AsyncSession, *, review_id: UUID
) -> list[ReviewCommentOut]:
    result = await session.execute(
        text(
            """
            SELECT
              id,
              review_id,
              author_kind,
              author_id,
              author_name,
              body,
              mentioned_worker_ids,
              created_at
            FROM review_comments
            WHERE review_id = CAST(:rid AS uuid)
            ORDER BY created_at ASC, id ASC
            """
        ),
        {"rid": str(review_id)},
    )

    out: list[ReviewCommentOut] = []
    for row in result.fetchall():
        m = row._mapping
        mentioned = m["mentioned_worker_ids"] or []
        out.append(
            ReviewCommentOut(
                id=m["id"],
                review_id=m["review_id"],
                author_kind=m["author_kind"],
                author_id=m["author_id"],
                author_name=m["author_name"],
                body=m["body"],
                mentioned_worker_ids=[UUID(str(x)) for x in mentioned],
                created_at=m["created_at"].isoformat()
                if hasattr(m["created_at"], "isoformat")
                else str(m["created_at"]),
            )
        )
    return out


async def create_review_comment(
    session: AsyncSession,
    *,
    review_id: UUID,
    author: ActorMeOut,
    body: str,
    mentioned_worker_ids: list[UUID] | None = None,
) -> ReviewCommentOut:
    mentioned_worker_ids = mentioned_worker_ids or []

    result = await session.execute(
        text(
            """
            INSERT INTO review_comments (
                review_id,
                author_kind,
                author_id,
                author_name,
                body,
                mentioned_worker_ids
            )
            VALUES (
                CAST(:rid AS uuid),
                :akind,
                CAST(:aid AS uuid),
                :aname,
                :body,
                CAST(:mentions AS uuid[])
            )
            RETURNING
                id, review_id, author_kind, author_id, author_name,
                body, mentioned_worker_ids, created_at
            """
        ),
        {
            "rid": str(review_id),
            "akind": author.kind,
            "aid": str(author.id),
            "aname": author.name,
            "body": body,
            "mentions": [str(x) for x in mentioned_worker_ids],
        },
    )
    comment = result.one()._mapping
    await session.commit()

    payload = {
        "id": str(comment["id"]),
        "review_id": str(comment["review_id"]),
        "author_kind": comment["author_kind"],
        "author_id": str(comment["author_id"]),
        "author_name": comment["author_name"],
        "body": comment["body"],
        "mentioned_worker_ids": [str(x) for x in (comment["mentioned_worker_ids"] or [])],
        "created_at": comment["created_at"].isoformat()
        if hasattr(comment["created_at"], "isoformat")
        else str(comment["created_at"]),
    }

    await manager.broadcast("comment.created", payload)

    # Mention notifications (only for workers).
    if mentioned_worker_ids:
        await create_notification(
            session,
            review_id=review_id,
            event_type="comment.mentioned",
            summary=f"Mentioned in comment · {author.name}",
            recipient_ids=mentioned_worker_ids,
        )
        await session.commit()

    return ReviewCommentOut(
        id=comment["id"],
        review_id=comment["review_id"],
        author_kind=comment["author_kind"],
        author_id=comment["author_id"],
        author_name=comment["author_name"],
        body=comment["body"],
        mentioned_worker_ids=[
            UUID(str(x)) for x in (comment["mentioned_worker_ids"] or [])
        ],
        created_at=payload["created_at"],
    )

