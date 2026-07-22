"""Comment mention / reply recipient selection + notification wiring."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.db.seed import OWNER_ID
from app.reviews.comments_service import reply_recipient_ids
from tests.test_assessment_pipeline import _wait_for_assessment
from tests.test_decisions import client  # noqa: F401

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")
WORKER_ASHA = UUID("55555555-5555-5555-5555-555555555551")
WORKER_IMRAN = UUID("55555555-5555-5555-5555-555555555552")
OWNER = UUID(OWNER_ID)


def test_reply_recipients_worker_notifies_owner():
    assert reply_recipient_ids(
        author_kind="worker",
        author_id=WORKER_ASHA,
        owner_id=OWNER,
        raised_by_worker_id=None,
        mentioned_worker_ids=[],
    ) == [OWNER]


def test_reply_recipients_worker_dedupes_when_owner_mentioned():
    # Owner is a user, not a worker — mentioned list is workers-only in practice,
    # but dedupe still applies if owner somehow appears.
    assert (
        reply_recipient_ids(
            author_kind="worker",
            author_id=WORKER_ASHA,
            owner_id=OWNER,
            raised_by_worker_id=None,
            mentioned_worker_ids=[OWNER],
        )
        == []
    )


def test_reply_recipients_operator_notifies_raised_by():
    assert reply_recipient_ids(
        author_kind="user",
        author_id=OWNER,
        owner_id=OWNER,
        raised_by_worker_id=WORKER_ASHA,
        mentioned_worker_ids=[],
    ) == [WORKER_ASHA]


def test_reply_recipients_operator_skips_when_raised_by_mentioned():
    assert (
        reply_recipient_ids(
            author_kind="user",
            author_id=OWNER,
            owner_id=OWNER,
            raised_by_worker_id=WORKER_ASHA,
            mentioned_worker_ids=[WORKER_ASHA],
        )
        == []
    )


def test_reply_recipients_operator_skips_without_raised_by():
    assert (
        reply_recipient_ids(
            author_kind="user",
            author_id=OWNER,
            owner_id=OWNER,
            raised_by_worker_id=None,
            mentioned_worker_ids=[],
        )
        == []
    )


async def _login(client: AsyncClient, actor_id: UUID) -> None:
    resp = await client.post("/auth/login", json={"actor_id": str(actor_id)})
    assert resp.status_code == 200, resp.text


async def _open_review(client: AsyncClient) -> str:
    now = datetime.now(timezone.utc)
    until = (now + timedelta(hours=4)).isoformat()
    r1 = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "sensor",
            "payload": {"gas_reading": 28.0, "unit": "ppm"},
            "provider": "simulator",
            "valid_from": now.isoformat(),
            "valid_until": until,
        },
    )
    assert r1.status_code == 200, r1.text
    review_id = r1.json()["review"]["id"]
    await _wait_for_assessment(client, review_id, require_pending_decision=True)
    return review_id


@pytest.mark.asyncio
async def test_comment_mention_and_reply_notifications(client: AsyncClient):
    review_id = await _open_review(client)

    await _login(client, WORKER_ASHA)
    mentioned = await client.post(
        f"/reviews/{review_id}/comments",
        json={
            "body": "Gas rising on battery — @Imran please check",
            "mentioned_worker_ids": [str(WORKER_IMRAN)],
        },
    )
    assert mentioned.status_code == 201, mentioned.text
    assert str(WORKER_IMRAN) in [
        str(x) for x in mentioned.json()["mentioned_worker_ids"]
    ]

    notes = (await client.get("/notifications?limit=50")).json()
    for_review = [n for n in notes if n.get("review_id") == review_id]
    mention = next(n for n in for_review if n["event_type"] == "comment.mentioned")
    assert str(WORKER_IMRAN) in mention["recipient_ids"]
    reply = next(n for n in for_review if n["event_type"] == "comment.replied")
    assert str(OWNER) in reply["recipient_ids"]
    assert str(WORKER_IMRAN) not in reply["recipient_ids"]

    # Set raised_by so operator reply notifies the supervisor who raised it.
    from app.db.session import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                UPDATE reviews
                SET raised_by_worker_id = CAST(:wid AS uuid)
                WHERE id = CAST(:rid AS uuid)
                """
            ),
            {"wid": str(WORKER_ASHA), "rid": review_id},
        )
        await session.commit()

    await _login(client, OWNER)
    op_comment = await client.post(
        f"/reviews/{review_id}/comments",
        json={"body": "Holding decision until LEL clears.", "mentioned_worker_ids": []},
    )
    assert op_comment.status_code == 201, op_comment.text

    notes2 = (await client.get("/notifications?limit=50")).json()
    op_replies = [
        n
        for n in notes2
        if n.get("review_id") == review_id
        and n["event_type"] == "comment.replied"
        and str(WORKER_ASHA) in n["recipient_ids"]
    ]
    assert op_replies
