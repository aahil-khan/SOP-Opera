"""W3a — GET /assets/coverage and the thresholds coverage section (DB-backed)."""

from __future__ import annotations

from datetime import datetime, timezone
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
    # Age the reading past the stale window directly in the DB. Both telemetry
    # tables have to be aged now that coverage reads the ambient ring too —
    # a live soft sample would legitimately keep the channel non-blind.
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
        await session.execute(
            text(
                "DELETE FROM telemetry_samples WHERE asset_id = CAST(:aid AS uuid)"
            ),
            {"aid": str(VESSEL_A)},
        )
        await session.commit()

    resp = await client.get("/assets/coverage")
    vessel = {r["asset_id"]: r for r in resp.json()}[str(VESSEL_A)]
    assert vessel["coverage"] == "blind"
    assert "absence of data" in vessel["reason"]


@pytest.mark.asyncio
async def test_seeded_mock_sensor_row_does_not_count_as_heard(
    client: AsyncClient,
):
    """
    A `quick_mock` row must never make an asset read `assessed`.

    `scripts/quick_mock_seed.py` writes `category='sensor'` context entries with
    `provider='quick_mock'` for the demonstration corpus. Those are fabricated:
    nothing was heard from the plant. If coverage counted them, an asset would
    render covered on the twin — with seeded mode off — purely because a demo
    row exists, which is the exact inversion this module was built to remove.

    Latent rather than theoretical: it only shows up once a corpus is generated
    with recent timestamps, which is why it is pinned here.
    """
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        await session.execute(
            text(
                "DELETE FROM context_entries WHERE asset_id = CAST(:aid AS uuid)"
            ),
            {"aid": str(VESSEL_A)},
        )
        await session.execute(
            text(
                "DELETE FROM telemetry_samples WHERE asset_id = CAST(:aid AS uuid)"
            ),
            {"aid": str(VESSEL_A)},
        )
        # A mock reading stamped right now — the worst case for staleness math.
        await session.execute(
            text(
                """
                INSERT INTO context_entries
                    (asset_id, category, payload, provider,
                     valid_from, valid_until, confidence)
                VALUES
                    (CAST(:aid AS uuid), 'sensor',
                     CAST('{"gas_reading": 5.0, "unit": "ppm"}' AS jsonb),
                     'quick_mock', now(), now() + interval '1 hour', 1.0)
                """
            ),
            {"aid": str(VESSEL_A)},
        )
        await session.commit()

    resp = await client.get("/assets/coverage")
    vessel = {r["asset_id"]: r for r in resp.json()}[str(VESSEL_A)]
    assert vessel["coverage"] == "blind", (
        "a seeded mock row was counted as a live sensor arrival"
    )

    async with SessionLocal() as session:
        await session.execute(
            text(
                "DELETE FROM context_entries "
                "WHERE asset_id = CAST(:aid AS uuid) AND provider = 'quick_mock'"
            ),
            {"aid": str(VESSEL_A)},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_ambient_soft_sample_alone_keeps_a_channel_covered(
    client: AsyncClient,
):
    """
    The blocker this fixes: the always-on ambient tick writes only
    `telemetry_samples` (simulator/ambient.py::_soft_tick →
    telemetry_store.persist_samples), never `context_entries`. Coverage used to
    read `context_entries` alone, so a fully instrumented plant reported every
    asset blind. One soft sample and no context entry must read as covered.
    """
    from app.db.session import SessionLocal
    from app.simulator.telemetry_store import persist_samples

    async with SessionLocal() as session:
        await session.execute(
            text(
                "DELETE FROM context_entries WHERE asset_id = CAST(:aid AS uuid)"
            ),
            {"aid": str(VESSEL_A)},
        )
        await session.execute(
            text(
                "DELETE FROM telemetry_samples WHERE asset_id = CAST(:aid AS uuid)"
            ),
            {"aid": str(VESSEL_A)},
        )
        await session.commit()

    resp = await client.get("/assets/coverage")
    vessel = {r["asset_id"]: r for r in resp.json()}[str(VESSEL_A)]
    assert vessel["coverage"] == "blind", "precondition: no telemetry at all"

    async with SessionLocal() as session:
        await persist_samples(
            session,
            [
                {
                    "asset_id": str(VESSEL_A),
                    "asset_name": "Vessel A",
                    "source": "scada",
                    "category": "sensor",
                    "payload": {"gas_reading": 5.0, "unit": "ppm"},
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "mode": "ambient",
                }
            ],
        )

    resp = await client.get("/assets/coverage")
    vessel = {r["asset_id"]: r for r in resp.json()}[str(VESSEL_A)]
    assert vessel["coverage"] == "assessed"
    assert vessel["seconds_since_sensor"] is not None


@pytest.mark.asyncio
async def test_seeded_degraded_channel_is_reachable_in_the_product(
    client: AsyncClient,
):
    """
    `degraded` has to be demonstrable without hand-crafting a POST /context —
    every scenario and ambient sample reports confidence >= 0.95 with no fault
    payload. seed_minimal plants exactly one unhealthy channel for this.
    """
    from app.db.seed import DEGRADED_SENSOR_ASSET_ID

    resp = await client.get("/assets/coverage")
    rows = {r["asset_id"]: r for r in resp.json()}
    row = rows[DEGRADED_SENSOR_ASSET_ID]
    assert row["coverage"] == "degraded"
    assert "fault" in row["reason"].lower()


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
    """
    Silence the whole plant and AI Ops must say so. This clears both telemetry
    tables itself rather than assuming a quiet database — coverage now reads
    the ambient ring, so a dev API running against the same Postgres (or an
    earlier test in this file) legitimately leaves every channel covered, and
    the old "fresh DB, therefore blind" assumption failed on ordering rather
    than on the behaviour it meant to assert.
    """
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        await session.execute(text("DELETE FROM telemetry_samples"))
        await session.execute(text("DELETE FROM context_entries"))
        await session.commit()

    resp = await client.get("/ai-ops/summary")
    assert resp.status_code == 200
    body = resp.json()
    assert body["asset_count"] > 0
    assert body["blind_channel_count"] == body["asset_count"]
    assert (
        body["blind_channel_count"] + body["degraded_channel_count"]
        <= body["asset_count"]
    )
