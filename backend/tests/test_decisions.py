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


async def _seeded_actor_cookie() -> str:
    """Encode a seeded user the way POST /auth/login does."""
    import json
    from urllib.parse import quote

    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        row = (
            await s.execute(text("SELECT id, name, role FROM users LIMIT 1"))
        ).first()
    m = row._mapping
    actor = {
        "id": str(m["id"]),
        "kind": "user",
        "name": m["name"],
        "role": m["role"],
        "owned_zones": [],
    }
    return quote(json.dumps(actor, separators=(",", ":")), safe="")


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

    # Endpoints that record who acted (e.g. POST /tasks/{id}/done) require the
    # actor cookie the real UI carries. Without it those calls 401, and the
    # assertions after them were unreachable.
    actor_cookie = await _seeded_actor_cookie()

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={"sop_actor": actor_cookie},
    ) as ac:
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
    # Build the blocking state explicitly rather than relying on context left
    # behind by earlier tests. Under the hazard-pathway policy a blocking verdict
    # needs a pathway, not merely three unrelated facts: elevated gas
    # (atmosphere) + a hot-work permit with no confirmed isolation
    # (ignition + control failure).
    now = datetime.now(timezone.utc)
    until = (now + timedelta(hours=4)).isoformat()
    frm = now.isoformat()

    gas = await client.post(
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
    assert gas.status_code == 200, gas.text
    review_id = gas.json()["review"]["id"]

    permit = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "permit",
            "payload": {
                "permit_id": "p-blocking-test",
                "status": "active",
                "work_type": "hot_work",
            },
            "provider": "simulator",
            "valid_from": frm,
            "valid_until": until,
        },
    )
    assert permit.status_code == 200, permit.text

    assessments = await _wait_for_assessment(
        client, review_id, require_pending_decision=True
    )
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
async def test_decision_persists_optional_comments(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]
    note = "Confirmed with shift lead before halting work."

    resp = await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "blocked",
            "recommendation_dispositions": {rec_id: "accepted"},
            "conditions": None,
            "comments": note,
        },
    )
    assert resp.status_code == 201, resp.text
    decision = resp.json()
    assert decision["comments"] == note

    detail = await client.get(f"/reviews/{review_id}")
    assert detail.status_code == 200
    assert detail.json()["decision"]["comments"] == note

    comments = (await client.get(f"/reviews/{review_id}/comments")).json()
    assert any(note in c["body"] and "Decision recorded" in c["body"] for c in comments)


@pytest.mark.asyncio
async def test_blocked_decision_locks_asset_until_unblock_task_completion(
    client: AsyncClient,
):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]

    from app.simulator.engine import demo_controller

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

    # Closing the review does NOT automatically unlock anymore.
    assert str(VESSEL_A) in demo_controller.inactive_asset_ids

    close = await client.post(f"/reviews/{review_id}/close")
    assert close.status_code == 200, close.text

    # Unlock via the created HITL "unblock" task.
    # Vessel A zone=coke-oven-battery → zone_owners points to worker_id 555...551 (Asha Rao).
    unblock_assignee = UUID("55555555-5555-5555-5555-555555555551")
    tasks_resp = await client.get(
        "/tasks",
        params={"assigned_worker_id": str(unblock_assignee)},
    )
    assert tasks_resp.status_code == 200, tasks_resp.text
    tasks = tasks_resp.json()
    unblock_tasks = [
        t for t in tasks if t["task_type"] == "unblock" and t["status"] != "done"
    ]
    assert unblock_tasks, "expected at least one unblock task"
    unblock_task_id = unblock_tasks[0]["id"]

    # /tasks/{id}/done requires an authenticated actor cookie.
    login = await client.post(
        "/auth/login", json={"actor_id": str(unblock_assignee)}
    )
    assert login.status_code == 200, login.text

    done_resp = await client.post(
        f"/tasks/{unblock_task_id}/done",
        json={"done_note": "Unblocked work permit after inspection."},
    )
    assert done_resp.status_code == 200, done_resp.text

    assert str(VESSEL_A) not in demo_controller.inactive_asset_ids
