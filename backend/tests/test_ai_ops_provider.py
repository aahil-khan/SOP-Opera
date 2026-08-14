"""W9a — runtime provider selection endpoints + per-assessment events listing."""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from tests.test_ai_ops_summary import _seed_mixed_assessments
from tests.test_assessment_pipeline import _cleanup_vessel

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest_asyncio.fixture
async def client():
    from app.assessment.provider_state import set_runtime_provider
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn, apply_schema, engine
    from app.db.seed import seed_minimal
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
    set_runtime_provider(None)

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    await _cleanup_vessel()

    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        await session.execute(text("DELETE FROM ai_ops_events"))
        await session.commit()

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    set_runtime_provider(None)
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_get_defaults_to_env(client: AsyncClient):
    resp = await client.get("/ai-ops/provider")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["active_provider"] == "mock"
    assert body["source"] == "env_default"
    assert body["env_default"] == "mock"
    assert set(body["available"]) == {"mock", "ollama", "openai_compatible"}


@pytest.mark.asyncio
async def test_provider_put_set_and_clear(client: AsyncClient):
    resp = await client.put("/ai-ops/provider", json={"provider": "ollama"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["active_provider"] == "ollama"
    assert body["source"] == "runtime_override"

    # GET reflects the override
    body = (await client.get("/ai-ops/provider")).json()
    assert body["active_provider"] == "ollama"

    # Clearing returns to the env default
    resp = await client.put("/ai-ops/provider", json={"provider": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["active_provider"] == "mock"
    assert body["source"] == "env_default"


@pytest.mark.asyncio
async def test_provider_put_rejects_unknown(client: AsyncClient):
    resp = await client.put("/ai-ops/provider", json={"provider": "gpt5"})
    assert resp.status_code == 400
    assert "gpt5" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_runtime_provider_stamped_on_enqueued_job(client: AsyncClient):
    """The AI Ops selection lands durably on the assessment row."""
    from app.db.session import SessionLocal
    from app.assessment.orchestrator import enqueue_for_review, orchestrator
    from app.reviews.repository import get_review

    await client.put("/ai-ops/provider", json={"provider": "ollama"})

    async with SessionLocal() as session:
        rev = await session.execute(
            text(
                """
                INSERT INTO reviews (asset_id, state, owner_id, triggered_by)
                VALUES (
                    CAST(:asset AS uuid), 'assessing',
                    CAST('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AS uuid), 'test'
                )
                RETURNING id
                """
            ),
            {"asset": str(VESSEL_A)},
        )
        review_id = rev.scalar_one()
        await session.commit()
        review = await get_review(session, review_id)
        assessment_id = await enqueue_for_review(session, review)
        assert assessment_id is not None

        row = await session.execute(
            text(
                """
                SELECT provider_override FROM assessments
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": str(assessment_id)},
        )
        assert row.scalar_one() == "ollama"
    orchestrator.drain()


@pytest.mark.asyncio
async def test_events_listing_newest_first(client: AsyncClient):
    await _seed_mixed_assessments()
    resp = await client.get("/ai-ops/events?limit=10")
    assert resp.status_code == 200, resp.text
    events = resp.json()
    assert len(events) == 4
    for e in events:
        assert e["provider"] == "mock"
        assert e["status"] in ("complete", "failed")
        assert "recorded_at" in e
    stamps = [e["recorded_at"] for e in events]
    assert stamps == sorted(stamps, reverse=True)
