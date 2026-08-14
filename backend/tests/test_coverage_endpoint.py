"""W3a — GET /assets/coverage and the thresholds coverage section (DB-backed)."""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from tests.test_assessment_pipeline import _cleanup_vessel

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


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

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_vector_pool()
    await engine.dispose()


async def _post_sensor(client: AsyncClient, payload: dict, confidence: float = 1.0):
    resp = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "sensor",
            "payload": payload,
            "provider": "test",
            "confidence": confidence,
        },
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_asset_with_fresh_sensor_is_assessed(client: AsyncClient):
    await _post_sensor(client, {"gas_reading": 5.0, "unit": "ppm"})
    resp = await client.get("/assets/coverage")
    assert resp.status_code == 200, resp.text
    rows = {r["asset_id"]: r for r in resp.json()}
    vessel = rows[str(VESSEL_A)]
    assert vessel["coverage"] == "assessed"
    assert vessel["seconds_since_sensor"] is not None


@pytest.mark.asyncio
async def test_low_confidence_sensor_degrades_coverage(client: AsyncClient):
    await _post_sensor(client, {"gas_reading": 5.0, "unit": "ppm"}, confidence=0.1)
    resp = await client.get("/assets/coverage")
    vessel = {r["asset_id"]: r for r in resp.json()}[str(VESSEL_A)]
    assert vessel["coverage"] == "degraded"


@pytest.mark.asyncio
async def test_stale_sensor_goes_blind_and_never_reads_safe(client: AsyncClient):
    await _post_sensor(client, {"gas_reading": 5.0, "unit": "ppm"})
    # Age the reading past the stale window directly in the DB.
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                UPDATE context_entries
                SET valid_from = now() - interval '1 hour',
                    valid_until = now() - interval '30 minutes'
                WHERE asset_id = CAST(:aid AS uuid) AND category = 'sensor'
                """
            ),
            {"aid": str(VESSEL_A)},
        )
        await session.commit()

    resp = await client.get("/assets/coverage")
    vessel = {r["asset_id"]: r for r in resp.json()}[str(VESSEL_A)]
    assert vessel["coverage"] == "blind"
    assert "absence of data" in vessel["reason"]


@pytest.mark.asyncio
async def test_thresholds_expose_coverage_knobs(client: AsyncClient):
    resp = await client.get("/api/config/thresholds")
    assert resp.status_code == 200
    cov = resp.json()["coverage"]
    assert cov["sensor_stale_after_seconds"] == 180
    assert cov["sensor_confidence_floor"] == 0.5

    resp = await client.put(
        "/api/config/thresholds",
        json={"coverage": {"sensor_stale_after_seconds": 60}},
    )
    assert resp.status_code == 200
    assert resp.json()["coverage"]["sensor_stale_after_seconds"] == 60
    # Restore for other tests in this process.
    resp = await client.put(
        "/api/config/thresholds",
        json={"coverage": {"sensor_stale_after_seconds": 180}},
    )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_ai_ops_summary_counts_blind_channels(client: AsyncClient):
    resp = await client.get("/ai-ops/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["asset_count"] > 0
    # Fresh DB with no ambient feed: every asset is blind until data arrives.
    assert body["blind_channel_count"] >= 1
    assert (
        body["blind_channel_count"] + body["degraded_channel_count"]
        <= body["asset_count"]
    )
