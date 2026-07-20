"""POST /reviews/{id}/decisions — Decision + Evidence freeze."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from tests.test_assessment_pipeline import _cleanup_vessel, _wait_for_assessment

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest_asyncio.fixture
async def client():
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn, apply_schema, engine
    from app.db.seed import seed_minimal
    from app.db.seed_embeddings import seed_embeddings
    from app.db.vector import close_vector_pool
    import asyncpg
    import os

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    os.environ["AI_PROVIDER"] = "mock"
    os.environ["EMBEDDING_PROVIDER"] = "mock"
    os.environ["BLOCKED_INACTIVE_MIN_SECONDS"] = "0.1"
    os.environ["BLOCKED_INACTIVE_MAX_SECONDS"] = "0.1"
    get_settings.cache_clear()

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    await seed_embeddings()
    await _cleanup_vessel()

    from app.main import app
    from app.assessment.orchestrator import orchestrator
    from app.simulator.engine import demo_controller

    orchestrator.start()
    demo_controller.clear_locks()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_vector_pool()
    await engine.dispose()


async def _bring_to_pending_decision(client: AsyncClient) -> tuple[str, list[dict]]:
    now = datetime.now(timezone.utc)
    until = (now + timedelta(hours=4)).isoformat()
    frm = now.isoformat()

    r1 = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "sensor",
            "payload": {"gas_reading": 28.0, "unit": "ppm"},
            "provider": "simulator",
            "valid_from": frm,
            "valid_until": until,
        },
    )
    assert r1.status_code == 200, r1.text
    review_id = r1.json()["review"]["id"]
    assessments = await _wait_for_assessment(
        client, review_id, require_pending_decision=True
    )
    return review_id, assessments


@pytest.mark.asyncio
async def test_decision_freezes_evidence_and_updates_dispositions(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    assert complete["retrieved_references"] or complete["metadata"]["retrieval_mode"] in (
        "deterministic",
        "rag",
        "skipped",
    )
    if complete["metadata"]["retrieval_mode"] != "skipped":
        assert complete["retrieved_references"], (
            "expected per-item retrieved_references when retrieval ran"
        )
        ref = complete["retrieved_references"][0]
        assert "source" in ref and "retrieval_path" in ref and "id" in ref

    rec_id = complete["recommendations"][0]["id"]
    decision_resp = await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "blocked",
            "recommendation_dispositions": {rec_id: "accepted"},
            "conditions": None,
        },
    )
    assert decision_resp.status_code == 201, decision_resp.text
    decision = decision_resp.json()
    assert decision["outcome"] == "blocked"
    assert decision["assessment_id"] == complete["id"]

    detail = await client.get(f"/reviews/{review_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["review"]["state"] == "decided"
    assert body["asset"]["id"] == str(VESSEL_A)
    assert body["decision"] is not None
    assert body["decision"]["id"] == decision["id"]

    # Evidence row exists
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        ev = await session.execute(
            text(
                """
                SELECT frozen_assessment_id, frozen_context_ids
                FROM evidence
                WHERE decision_id = CAST(:did AS uuid)
                """
            ),
            {"did": decision["id"]},
        )
        row = ev.first()
        assert row is not None
        assert str(row._mapping["frozen_assessment_id"]) == complete["id"]
        assert len(row._mapping["frozen_context_ids"] or []) >= 1

        rec = await session.execute(
            text(
                "SELECT disposition FROM recommendations WHERE id = CAST(:id AS uuid)"
            ),
            {"id": rec_id},
        )
        assert rec.scalar_one() == "accepted"


@pytest.mark.asyncio
async def test_decision_requires_conditions_for_approved_with_conditions(
    client: AsyncClient,
):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    resp = await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "approved_with_conditions",
            "recommendation_dispositions": {
                complete["recommendations"][0]["id"]: "accepted"
            },
            "conditions": None,
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_decision_rejected_when_not_pending(client: AsyncClient):
    # Open a review still assessing (or freshly opened) without waiting — force decision too early.
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        rid = (
            await session.execute(
                text(
                    """
                    INSERT INTO reviews (asset_id, state, triggered_by, owner_id)
                    VALUES (
                        CAST(:aid AS uuid), 'assessing', 'test',
                        (SELECT id FROM users LIMIT 1)
                    )
                    RETURNING id
                    """
                ),
                {"aid": str(VESSEL_A)},
            )
        ).scalar_one()
        await session.commit()

    resp = await client.post(
        f"/reviews/{rid}/decisions",
        json={"outcome": "blocked", "recommendation_dispositions": {}},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_decision_rejected_without_complete_assessment(client: AsyncClient):
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        rid = (
            await session.execute(
                text(
                    """
                    INSERT INTO reviews (asset_id, state, triggered_by, owner_id)
                    VALUES (
                        CAST(:aid AS uuid), 'pending_decision', 'test',
                        (SELECT id FROM users LIMIT 1)
                    )
                    RETURNING id
                    """
                ),
                {"aid": str(VESSEL_A)},
            )
        ).scalar_one()
        await session.commit()

    resp = await client.post(
        f"/reviews/{rid}/decisions",
        json={"outcome": "blocked", "recommendation_dispositions": {}},
    )
    assert resp.status_code == 409
    assert "complete Assessment" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_blocking_assessment_rejects_approved_outcome(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]
    assert complete["risk_level"] == "blocking"

    resp = await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "approved",
            "recommendation_dispositions": {rec_id: "accepted"},
            "conditions": None,
        },
    )
    assert resp.status_code == 409
    assert "only be submitted with outcome=blocked" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_blocked_decision_locks_asset_until_close_and_timer(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]

    from app.simulator.engine import demo_controller
    monkeypatch.setattr("app.decisions.service.random.uniform", lambda _a, _b: 0.1)

    decision_resp = await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "blocked",
            "recommendation_dispositions": {rec_id: "accepted"},
            "conditions": None,
        },
    )
    assert decision_resp.status_code == 201, decision_resp.text
    assert str(VESSEL_A) in demo_controller.inactive_asset_ids

    # Timer alone is not enough — review must also close.
    await asyncio.sleep(0.2)
    assert str(VESSEL_A) in demo_controller.inactive_asset_ids

    close = await client.post(f"/reviews/{review_id}/close")
    assert close.status_code == 200, close.text
    await asyncio.sleep(0.2)
    assert str(VESSEL_A) not in demo_controller.inactive_asset_ids
