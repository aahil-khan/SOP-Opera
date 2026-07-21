"""Escalate / de-escalate review API."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.test_decisions import _bring_to_pending_decision, client  # noqa: F401


@pytest.mark.asyncio
async def test_escalate_and_de_escalate_round_trip(client: AsyncClient):
    review_id, _assessments = await _bring_to_pending_decision(client)

    escalated = await client.post(
        f"/reviews/{review_id}/escalate",
        json={"reason": "Needs shift lead"},
    )
    assert escalated.status_code == 200, escalated.text
    assert escalated.json()["state"] == "escalated"

    notes = await client.get("/notifications?limit=50")
    assert notes.status_code == 200
    assert any(
        n.get("event_type") == "review.escalated" and n.get("review_id") == review_id
        for n in notes.json()
    )

    resolved = await client.post(
        f"/reviews/{review_id}/de-escalate",
        json={"reason": "Lead reviewed — back to operator"},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["state"] == "pending_decision"

    notes2 = await client.get("/notifications?limit=50")
    assert any(
        n.get("event_type") == "review.de_escalated"
        and n.get("review_id") == review_id
        for n in notes2.json()
    )


@pytest.mark.asyncio
async def test_de_escalate_rejected_when_not_escalated(client: AsyncClient):
    review_id, _assessments = await _bring_to_pending_decision(client)
    resp = await client.post(
        f"/reviews/{review_id}/de-escalate",
        json={"reason": ""},
    )
    assert resp.status_code == 409
