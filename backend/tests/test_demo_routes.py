"""HTTP-level tests for /demo/* endpoints."""

from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest_asyncio.fixture
async def client():
    from app.core.config import get_settings
    from app.db.session import apply_schema, engine, _asyncpg_dsn
    from app.db.vector import close_vector_pool
    from app.db.seed import seed_minimal
    from app.simulator.engine import demo_controller
    from app.assessment.orchestrator import orchestrator
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
    await demo_controller.reset()
    orchestrator.start()

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    await demo_controller.reset()
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_list_scenarios(client: AsyncClient):
    resp = await client.get("/demo/scenarios")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    names = {s["name"] for s in body}
    assert names == {"gas_leak", "permit_conflict", "compound_risk"}
    for s in body:
        assert "label" in s
        assert s["step_count"] >= 1


@pytest.mark.asyncio
async def test_start_unknown_scenario_404(client: AsyncClient):
    resp = await client.post("/demo/scenarios/nope/start")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_start_and_status_and_reset(client: AsyncClient):
    # Use multi-step scenario so it stays running long enough for 409 check
    start = await client.post("/demo/scenarios/compound_risk/start")
    assert start.status_code == 202, start.text
    body = start.json()
    assert body["running"] is True
    assert body["scenario"] == "compound_risk"

    again = await client.post("/demo/scenarios/permit_conflict/start")
    assert again.status_code == 409

    reset = await client.post("/demo/reset")
    assert reset.status_code == 200
    assert reset.json()["status"] == "reset"

    idle = await client.get("/demo/status")
    assert idle.status_code == 200
    assert idle.json()["running"] is False
    assert idle.json()["scenario"] is None

    # Clean start of a short scenario after reset
    start2 = await client.post("/demo/scenarios/gas_leak/start")
    assert start2.status_code == 202, start2.text

    deadline = asyncio.get_event_loop().time() + 15.0
    while asyncio.get_event_loop().time() < deadline:
        st = await client.get("/demo/status")
        if not st.json()["running"]:
            break
        await asyncio.sleep(0.15)
    else:
        pytest.fail("gas_leak scenario did not finish in time")


@pytest.mark.asyncio
async def test_random_start_and_conflict_and_reset(client: AsyncClient):
    start = await client.post(
        "/demo/random/start",
        json={
            "max_concurrent_issues": 3,
            "spawn_interval_min_seconds": 0.5,
            "spawn_interval_max_seconds": 0.8,
            "seed": 7,
            "issue_cap": 2,
            "floors": ["ground"],
        },
    )
    assert start.status_code == 202, start.text
    body = start.json()
    assert body["running"] is True
    assert body["mode"] == "random"
    assert body["config"]["seed"] == 7

    conflict = await client.post("/demo/scenarios/gas_leak/start")
    assert conflict.status_code == 409

    reset = await client.post("/demo/reset")
    assert reset.status_code == 200
    idle = await client.get("/demo/status")
    assert idle.json()["running"] is False
    assert idle.json()["mode"] == "idle"
