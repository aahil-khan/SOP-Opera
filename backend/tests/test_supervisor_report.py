"""Supervisor floor issue reports with optional worker tags."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.test_context_flow import client  # noqa: F401

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")
ASHA = UUID("55555555-5555-5555-5555-555555555551")
DEV = UUID("55555555-5555-5555-5555-555555555552")


@pytest.mark.asyncio
async def test_supervisor_report_tags_workers_and_lists_shared(client: AsyncClient):
    resp = await client.post(
        "/reviews",
        json={
            "asset_id": str(VESSEL_A),
            "description": "Unusual vibration on the deck",
            "concern_type": "equipment",
            "raised_by_worker_id": str(ASHA),
            "tagged_worker_ids": [str(DEV), str(ASHA)],
        },
    )
    assert resp.status_code == 201, resp.text
    review_id = resp.json()["id"]

    notes = await client.get("/notifications?limit=50")
    assert notes.status_code == 200
    tagged_notes = [
        n
        for n in notes.json()
        if n.get("event_type") == "supervisor_report.tagged"
        and n.get("review_id") == review_id
    ]
    assert len(tagged_notes) == 1
    assert str(DEV) in tagged_notes[0]["recipient_ids"]
    assert str(ASHA) not in tagged_notes[0]["recipient_ids"]

    login = await client.post("/auth/login", json={"actor_id": str(DEV)})
    assert login.status_code == 200

    shared = await client.get("/reviews/shared-with-me")
    assert shared.status_code == 200
    items = shared.json()
    assert any(item["review_id"] == review_id for item in items)
    match = next(item for item in items if item["review_id"] == review_id)
    assert "vibration" in match["description"].lower()
    assert match["raised_by_name"]
    assert match["concern_type"] == "equipment"

    login_reporter = await client.post("/auth/login", json={"actor_id": str(ASHA)})
    assert login_reporter.status_code == 200

    raised = await client.get("/reviews/raised-by-me")
    assert raised.status_code == 200
    assert any(item["review_id"] == review_id for item in raised.json())

    operator_notes = [
        n
        for n in notes.json()
        if n.get("review_id") == review_id and n.get("event_type") == "review.opened"
    ]
    assert len(operator_notes) == 1


@pytest.mark.asyncio
async def test_supervisor_report_reopens_existing_decided_review(client: AsyncClient):
    """Second supervisor report on same asset reopens instead of duplicating."""
    from tests.test_decisions import _bring_to_pending_decision

    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]

    decision = await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "blocked",
            "recommendation_dispositions": {rec_id: "accepted"},
        },
    )
    assert decision.status_code == 201, decision.text

    resp = await client.post(
        "/reviews",
        json={
            "asset_id": str(VESSEL_A),
            "description": "Still vibrating after the decision",
            "concern_type": "equipment",
            "raised_by_worker_id": str(ASHA),
            "tagged_worker_ids": [],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["id"] == review_id
    assert body["state"] == "assessing"

    # No second open review for the same asset.
    listed = await client.get("/reviews", params={"asset_id": str(VESSEL_A)})
    assert listed.status_code == 200
    active = [r for r in listed.json() if r["state"] != "closed"]
    assert len(active) == 1
    assert active[0]["id"] == review_id


@pytest.mark.asyncio
async def test_raised_by_me_includes_decided_reviews(client: AsyncClient):
    resp = await client.post(
        "/reviews",
        json={
            "asset_id": str(VESSEL_A),
            "description": "Gas smell near the valve",
            "concern_type": "safety_hazard",
            "raised_by_worker_id": str(ASHA),
            "tagged_worker_ids": [],
        },
    )
    assert resp.status_code == 201, resp.text
    review_id = resp.json()["id"]

    # Force decided without going through full assessment wait when possible —
    # use reopen path is not needed; close isn't allowed from assessing.
    # Bring through assessment + decision via context helper if needed is heavy;
    # instead transition via SQL for this visibility check.
    from app.db.session import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                UPDATE reviews
                SET state = 'decided'
                WHERE id = CAST(:rid AS uuid)
                """
            ),
            {"rid": review_id},
        )
        await session.commit()

    login = await client.post("/auth/login", json={"actor_id": str(ASHA)})
    assert login.status_code == 200

    raised = await client.get("/reviews/raised-by-me")
    assert raised.status_code == 200
    match = next(item for item in raised.json() if item["review_id"] == review_id)
    assert match["review_state"] == "decided"

