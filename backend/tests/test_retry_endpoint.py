"""POST /reviews/{id}/assessments/retry — the recovery path a supervisor uses
when an assessment fails and they want to try again (optionally on a different
provider) without falling all the way back to a Manual Assessment."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from tests.test_assessment_pipeline import _cleanup_vessel, _wait_for_assessment

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest_asyncio.fixture
async def client(monkeypatch):
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn
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

    from app.db.session import apply_schema, engine
    from app.db.vector import close_vector_pool

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    from app.db.seed import seed_minimal
    from app.db.seed_embeddings import seed_embeddings

    await seed_minimal()
    await seed_embeddings()
    await _cleanup_vessel()

    # The first assessment job must fail outright, then the retry must succeed.
    #
    # The pipeline retries internally up to `assessment_max_retries`, so failing a
    # single call is not enough — attempt 2 would succeed and the job would never
    # reach `failed`, leaving the retry endpoint nothing to retry. Fail every
    # attempt of the first job instead, and let the retried job run for real.
    from app.agents.graph import run_agent_assessment as real_run_agent_assessment
    from app.core.config import get_settings

    attempts_per_job = get_settings().assessment_max_retries + 1
    state = {"calls": 0}

    async def flaky_run(*args, **kwargs):
        state["calls"] += 1
        if state["calls"] <= attempts_per_job:
            raise RuntimeError("forced failure for retry test")
        return await real_run_agent_assessment(*args, **kwargs)

    monkeypatch.setattr("app.assessment.pipeline.run_agent_assessment", flaky_run)

    from app.main import app
    from app.assessment.orchestrator import orchestrator

    orchestrator.start()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_retry_after_failure_completes_and_reaches_pending_decision(
    client: AsyncClient,
):
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

    first_pass = await _wait_for_assessment(client, review_id)
    assert any(a["status"] == "failed" for a in first_pass), first_pass

    detail = await client.get(f"/reviews/{review_id}")
    assert detail.json()["review"]["state"] == "assessing"

    retry_resp = await client.post(
        f"/reviews/{review_id}/assessments/retry",
        json={"provider": "mock"},
    )
    assert retry_resp.status_code == 202, retry_resp.text
    body = retry_resp.json()
    assert body["review_id"] == review_id
    assert body["status"] == "pending"

    second_pass = await _wait_for_assessment(
        client, review_id, min_version=2, require_pending_decision=True
    )
    latest = [a for a in second_pass if a["version"] >= 2 and a["status"] == "complete"]
    assert latest, second_pass

    detail2 = await client.get(f"/reviews/{review_id}")
    assert detail2.json()["review"]["state"] == "pending_decision"


@pytest.mark.asyncio
async def test_retry_rejected_when_not_assessing(client: AsyncClient):
    resp = await client.post(
        f"/reviews/{UUID(int=0)}/assessments/retry", json={"provider": "mock"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_retry_rejected_while_already_in_flight(client: AsyncClient):
    # Deterministic setup via direct DB writes (rather than racing the real worker)
    # so the "already pending/generating" guard is exercised reliably.
    from app.db.session import SessionLocal
    from sqlalchemy import text

    async with SessionLocal() as session:
        review_id = (
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
        await session.execute(
            text(
                """
                INSERT INTO assessments (review_id, assessment_type, status, version)
                VALUES (CAST(:rid AS uuid), 'ai', 'pending', 1)
                """
            ),
            {"rid": str(review_id)},
        )
        await session.commit()

    retry_resp = await client.post(f"/reviews/{review_id}/assessments/retry")
    assert retry_resp.status_code == 409
