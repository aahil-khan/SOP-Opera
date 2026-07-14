from __future__ import annotations

import asyncio
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
    from app.db.session import apply_schema, _asyncpg_dsn
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

    # Force provider to always fail so we exercise failed → manual path
    class BoomProvider:
        async def generate_assessment(self, *args, **kwargs):
            raise RuntimeError("forced provider failure for test")

    monkeypatch.setattr(
        "app.assessment.providers.get_provider",
        lambda name=None: BoomProvider(),
    )
    monkeypatch.setattr(
        "app.assessment.pipeline.get_provider",
        lambda name=None: BoomProvider(),
    )

    from app.main import app
    from app.assessment.orchestrator import orchestrator

    orchestrator.start()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    from app.db.vector import close_vector_pool

    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_failed_assessment_then_manual(client: AsyncClient):
    now = datetime.now(timezone.utc)
    until = (now + timedelta(hours=4)).isoformat()
    frm = now.isoformat()

    r1 = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "sensor",
            "payload": {"gas_reading": 30.0, "unit": "ppm"},
            "provider": "simulator",
            "valid_from": frm,
            "valid_until": until,
        },
    )
    assert r1.status_code == 200, r1.text
    review_id = r1.json()["review"]["id"]

    assessments = await _wait_for_assessment(client, review_id)
    assert any(a["status"] == "failed" for a in assessments), assessments

    detail = await client.get(f"/reviews/{review_id}")
    assert detail.json()["review"]["state"] == "assessing"

    manual = await client.post(
        f"/reviews/{review_id}/assessments/manual",
        json={
            "summary": "Supervisor confirms elevated gas; evacuate and retest.",
            "risk_level": "blocking",
            "recommendations": [
                {
                    "text": "Evacuate zone and retest atmosphere",
                    "rationale": "AI failed; manual override based on gas reading",
                }
            ],
        },
    )
    assert manual.status_code == 201, manual.text
    body = manual.json()
    assert body["assessment_type"] == "manual"
    assert body["status"] == "complete"
    assert body["risk_level"] == "blocking"

    detail2 = await client.get(f"/reviews/{review_id}")
    assert detail2.json()["review"]["state"] == "pending_decision"

    history = await client.get(f"/reviews/{review_id}/assessments")
    statuses = {a["status"] for a in history.json()}
    assert "failed" in statuses
    assert "complete" in statuses
