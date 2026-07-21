"""Webhook ingest + assessment queue smoke tests."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture
def client():
    from app.main import app

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_webhook_ingest_by_asset_name_requires_db(client: AsyncClient):
    """When DB is up this creates context; when down, expect 5xx/connection skip."""
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn
    import asyncpg

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
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn
    import asyncpg

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
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn
    import asyncpg

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
