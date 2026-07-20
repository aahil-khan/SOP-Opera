"""GET /ai-ops/summary aggregate math."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from tests.test_assessment_pipeline import _cleanup_vessel

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")
OWNER = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")


@pytest_asyncio.fixture
async def client():
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
    await close_vector_pool()
    await engine.dispose()


async def _seed_mixed_assessments() -> None:
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        rev = await session.execute(
            text(
                """
                INSERT INTO reviews (asset_id, state, owner_id, triggered_by)
                VALUES (
                    CAST(:asset AS uuid), 'closed',
                    CAST(:owner AS uuid), 'test'
                )
                RETURNING id
                """
            ),
            {"asset": str(VESSEL_A), "owner": str(OWNER)},
        )
        review_id = rev.scalar_one()

        async def insert_event(
            *,
            status: str,
            retrieval_mode: str | None,
            retrieval_score: float | None,
            failure_reason: str | None,
            tokens_in: int | None = None,
            tokens_out: int | None = None,
            cost_usd: float | None = None,
            latency_ms: int | None = None,
        ) -> None:
            aid = uuid4()
            await session.execute(
                text(
                    """
                    INSERT INTO ai_ops_events (
                        assessment_id, review_id, status, provider,
                        retrieval_mode, retrieval_score, failure_reason,
                        tokens_in, tokens_out, cost_usd, latency_ms
                    )
                    VALUES (
                        CAST(:id AS uuid), CAST(:review_id AS uuid),
                        :status, 'mock', :mode, :score, :failure_reason,
                        :tokens_in, :tokens_out, :cost_usd, :latency_ms
                    )
                    """
                ),
                {
                    "id": str(aid),
                    "review_id": str(review_id),
                    "status": status,
                    "mode": retrieval_mode,
                    "score": retrieval_score,
                    "failure_reason": failure_reason,
                    "tokens_in": tokens_in,
                    "tokens_out": tokens_out,
                    "cost_usd": cost_usd,
                    "latency_ms": latency_ms,
                },
            )

        await insert_event(
            status="complete",
            retrieval_mode="rag",
            retrieval_score=0.9,
            failure_reason=None,
            tokens_in=100,
            tokens_out=40,
            cost_usd=0.001,
            latency_ms=200,
        )
        await insert_event(
            status="complete",
            retrieval_mode="deterministic",
            retrieval_score=None,
            failure_reason=None,
            tokens_in=50,
            tokens_out=20,
            cost_usd=0.0,
            latency_ms=100,
        )
        await insert_event(
            status="failed",
            retrieval_mode="rag",
            retrieval_score=0.2,
            failure_reason="validation",
        )
        await insert_event(
            status="failed",
            retrieval_mode="deterministic",
            retrieval_score=None,
            failure_reason="provider_error",
        )
        await session.commit()


@pytest.mark.asyncio
async def test_ai_ops_summary_math(client: AsyncClient):
    await _seed_mixed_assessments()
    resp = await client.get("/ai-ops/summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["total_assessments"] == 4
    assert body["complete_count"] == 2
    assert body["failed_count"] == 2
    assert body["success_rate"] == 0.5
    assert body["data_source"] == "local_db"
    assert body["persists_across_demo_reset"] is True
    assert body["validation_failure_count"] == 1
    assert body["provider_error_count"] == 1
    assert body["retrieval_ran_count"] == 4
    assert body["rag_hit_rate"] == 0.5
    assert body["rag_fallback_rate"] == 0.5
    assert body["mean_retrieval_relevance"] is not None
    # mean of 0.9 and 0.2
    assert abs(body["mean_retrieval_relevance"] - 0.55) < 0.01
    assert body["total_input_tokens"] == 150
    assert body["total_output_tokens"] == 60
    assert abs(body["total_cost_usd"] - 0.001) < 1e-9
    assert body["mean_latency_ms"] is not None
    assert abs(body["mean_latency_ms"] - 150.0) < 0.1
    assert "langsmith_enabled" in body
    assert "langsmith_project" in body
    assert body["langsmith_project"] == "sop-opera"


@pytest.mark.asyncio
async def test_ai_ops_events_survive_demo_reset(client: AsyncClient):
    await _seed_mixed_assessments()
    before = await client.get("/ai-ops/summary")
    assert before.status_code == 200
    assert before.json()["total_assessments"] == 4

    reset = await client.post("/demo/reset")
    assert reset.status_code == 200

    after = await client.get("/ai-ops/summary")
    assert after.status_code == 200
    body = after.json()
    assert body["total_assessments"] == 4
    assert body["complete_count"] == 2
    assert body["failed_count"] == 2