"""failure_reason classification on assessment failure."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
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
    get_settings.cache_clear()

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    await seed_embeddings()
    await _cleanup_vessel()

    from app.main import app
    from app.assessment.orchestrator import orchestrator

    orchestrator.start()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_vector_pool()
    await engine.dispose()


async def _trigger(client: AsyncClient) -> str:
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
    return r1.json()["review"]["id"]


async def _failure_reason_for(assessment_id: str) -> str | None:
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT failure_reason FROM assessment_metadata
                WHERE assessment_id = CAST(:id AS uuid)
                """
            ),
            {"id": assessment_id},
        )
        row = result.first()
        return row._mapping["failure_reason"] if row else None


@pytest.mark.asyncio
async def test_provider_error_failure_reason(client: AsyncClient, monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr("app.assessment.pipeline.run_agent_assessment", boom)

    review_id = await _trigger(client)
    assessments = await _wait_for_assessment(client, review_id)
    failed = next(a for a in assessments if a["status"] == "failed")
    assert await _failure_reason_for(failed["id"]) == "provider_error"


@pytest.mark.asyncio
async def test_validation_failure_reason(client: AsyncClient, monkeypatch):
    async def bad_schema(*args, **kwargs):
        # Force a pydantic ValidationError matching pipeline classification.
        raise ValidationError.from_exception_data(
            "AssessmentResult",
            [{"type": "missing", "loc": ("summary",), "input": {}}],
        )

    monkeypatch.setattr("app.assessment.pipeline.run_agent_assessment", bad_schema)

    review_id = await _trigger(client)
    assessments = await _wait_for_assessment(client, review_id)
    failed = next(a for a in assessments if a["status"] == "failed")
    assert await _failure_reason_for(failed["id"]) == "validation"
