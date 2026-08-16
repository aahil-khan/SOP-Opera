"""Webhook ingest + assessment queue smoke tests."""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest_asyncio.fixture
async def client():
    """
    Async client with the engine disposed either side of the test.

    `asyncio_default_fixture_loop_scope = function` gives every test its own
    event loop, while the app's engine and vector pool are module-level. A
    connection pooled on one test's loop is terminated on a later one, which
    raises `RuntimeError: Event loop is closed` during teardown — the assertions
    having already passed. Disposing before and after keeps each pool inside a
    single loop; this mirrors the fixture the other DB-backed test files use.
    """
    from app.db.session import engine
    from app.db.vector import close_vector_pool
    from app.main import app

    await close_vector_pool()
    await engine.dispose()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_webhook_ingest_by_asset_name_requires_db(client: AsyncClient):
    """When DB is up this creates context; when down, expect 5xx/connection skip."""
    import asyncpg

    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    resp = await client.post(
        "/api/ingest/webhook",
        json={
            "source_system": "scada-historian",
            "asset_name": "Vessel A",
            "readings": [
                {"metric": "gas_reading", "value": 28.0, "unit": "ppm"}
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] == 1
    assert body["results"][0]["context"]["provider"] == "scada-historian"
    assert body["results"][0]["context"]["asset_id"] == str(VESSEL_A)


@pytest.mark.asyncio
async def test_webhook_rejects_unknown_asset(client: AsyncClient):
    import asyncpg

    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    resp = await client.post(
        "/api/ingest/webhook",
        json={
            "source_system": "scada-historian",
            "asset_name": "No Such Asset",
            "readings": [{"metric": "gas_reading", "value": 10.0}],
        },
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_assessment_queue_endpoint(client: AsyncClient):
    import asyncpg

    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    resp = await client.get("/api/assessment-jobs/queue")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "pending" in body
    assert "generating" in body
    assert "workers" in body
    assert "jobs" in body


@pytest.mark.asyncio
async def test_webhook_validation_error(client: AsyncClient):
    resp = await client.post(
        "/api/ingest/webhook",
        json={"source_system": "scada"},
    )
    assert resp.status_code == 422
