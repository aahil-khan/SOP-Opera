"""Tests for quiet soft-telemetry ring persistence."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio


async def _bootstrap_db():
    import os

    import asyncpg
    import pytest as _pytest

    from app.core.config import get_settings
    from app.db.seed import seed_minimal
    from app.db.session import _asyncpg_dsn, apply_schema, engine
    from app.db.vector import close_vector_pool

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        _pytest.skip(f"Postgres unreachable: {exc}")

    os.environ["AI_PROVIDER"] = "mock"
    os.environ["EMBEDDING_PROVIDER"] = "mock"
    get_settings.cache_clear()

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    return engine


@pytest_asyncio.fixture
async def db_ready():
    from app.db.session import engine
    from app.db.vector import close_vector_pool

    await _bootstrap_db()
    yield
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_persist_and_list_recent_keeps_ring(db_ready):
    from sqlalchemy import text

    from app.db.session import SessionLocal
    from app.simulator.telemetry_store import list_recent_samples, persist_samples

    async with SessionLocal() as session:
        row = (
            await session.execute(
                text("SELECT id, name FROM assets ORDER BY name LIMIT 1")
            )
        ).one()
        asset_id = str(row._mapping["id"])
        asset_name = row._mapping["name"]

        await session.execute(
            text("DELETE FROM telemetry_samples WHERE asset_id = CAST(:id AS uuid)"),
            {"id": asset_id},
        )
        await session.commit()

        base = datetime.now(timezone.utc) - timedelta(minutes=10)
        samples = [
            {
                "source": "scada",
                "asset_id": asset_id,
                "asset_name": asset_name,
                "category": "sensor",
                "payload": {"gas_reading": float(i), "unit": "ppm"},
                "ts": (base + timedelta(seconds=i * 3)).isoformat(),
                "mode": "ambient",
            }
            for i in range(12)
        ]
        n = await persist_samples(session, samples, keep_per_asset=5)
        assert n == 12

        recent = await list_recent_samples(session, per_asset=30, asset_id=None)
        mine = [s for s in recent if s["asset_id"] == asset_id]
        assert len(mine) == 5
        # Oldest → newest after prune keeps the last 5
        assert [s["payload"]["gas_reading"] for s in mine] == [7.0, 8.0, 9.0, 10.0, 11.0]
        assert mine[0]["ts"] < mine[-1]["ts"]


@pytest.mark.asyncio
async def test_recent_endpoint_shape(db_ready):
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/demo/telemetry/recent", params={"per_asset": 10})
        assert res.status_code == 200
        body = res.json()
        assert "samples" in body
        assert "count" in body
        assert isinstance(body["samples"], list)
        assert body["count"] == len(body["samples"])
        for sample in body["samples"][:3]:
            assert "asset_id" in sample
            assert "payload" in sample
            assert "ts" in sample
            assert "category" in sample
