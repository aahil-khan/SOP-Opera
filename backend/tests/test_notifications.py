"""Notifications created on domain events + GET /notifications."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.test_assessment_pipeline import _wait_for_assessment
from tests.test_decisions import _bring_to_pending_decision, client  # noqa: F401
from tests.test_review_closure import _decide

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest.mark.asyncio
async def test_notifications_on_decision_and_close(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    await _decide(client, review_id, assessments)
    close = await client.post(f"/reviews/{review_id}/close")
    assert close.status_code == 200

    resp = await client.get("/notifications?limit=50")
    assert resp.status_code == 200
    notes = resp.json()
    types = {n["event_type"] for n in notes if n.get("review_id") == review_id}
    assert "decision.submitted" in types
    assert "review.closed" in types
    # Assessment completed should fire for elevated/blocking (gas leak scenarios).
    assert "assessment.completed" in types or "review.opened" in types


@pytest.mark.asyncio
async def test_notifications_on_assessment_failed(client: AsyncClient, monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("forced failure")

    monkeypatch.setattr("app.assessment.pipeline.run_agent_assessment", boom)

    now = datetime.now(timezone.utc)
    until = (now + timedelta(hours=4)).isoformat()
    r1 = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "sensor",
            "payload": {"gas_reading": 30.0, "unit": "ppm"},
            "provider": "simulator",
            "valid_from": now.isoformat(),
            "valid_until": until,
        },
    )
    assert r1.status_code == 200, r1.text
    review_id = r1.json()["review"]["id"]
    assessments = await _wait_for_assessment(client, review_id)
    assert any(a["status"] == "failed" for a in assessments)

    notes = (await client.get("/notifications")).json()
    assert any(
        n["event_type"] == "assessment.failed" and n["review_id"] == review_id
        for n in notes
    )


@pytest.mark.asyncio
async def test_critical_assessment_notification_uses_critical_summary(monkeypatch):
    captured: dict = {}

    async def fake_create(session, **kwargs):
        captured.update(kwargs)
        return UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    monkeypatch.setattr(
        "app.notifications.service.create_notification",
        fake_create,
    )

    from app.notifications.service import notify_assessment_completed

    review_id = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    owner_id = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
    await notify_assessment_completed(
        None,  # type: ignore[arg-type]
        review_id=review_id,
        owner_id=owner_id,
        risk_level="blocking",
        sensor_critical=True,
    )

    assert captured["event_type"] == "assessment.completed"
    assert "Critical" in captured["summary"]
    assert "blocking" not in captured["summary"].lower()


@pytest.mark.asyncio
async def test_notifications_limit(client: AsyncClient):
    resp = await client.get("/notifications?limit=1")
    assert resp.status_code == 200
    assert len(resp.json()) <= 1
