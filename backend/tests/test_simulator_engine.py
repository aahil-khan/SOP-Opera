"""Integration tests for DemoController start/reset/concurrency."""

from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.simulator.engine import (
    ScenarioAlreadyRunningError,
    DemoController,
    demo_controller,
)


async def _bootstrap():
    from app.core.config import get_settings
    from app.db.session import apply_schema, engine, _asyncpg_dsn
    from app.db.vector import close_vector_pool
    from app.db.seed import seed_minimal
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

    from app.assessment.orchestrator import orchestrator

    orchestrator.start()
    # Ensure demo controller is idle
    await demo_controller.reset()
    return engine, orchestrator


@pytest_asyncio.fixture
async def ready():
    from app.db.vector import close_vector_pool
    from app.db.session import engine

    await _bootstrap()
    yield
    await demo_controller.reset()
    await close_vector_pool()
    await engine.dispose()


async def _wait_idle(ctrl: DemoController, *, timeout: float = 30.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        st = ctrl.status()
        if not st["running"]:
            return st
        await asyncio.sleep(0.1)
    raise AssertionError(f"scenario still running after {timeout}s: {ctrl.status()}")


@pytest.mark.asyncio
async def test_gas_leak_drives_review(ready):
    from app.db.session import SessionLocal

    status = await demo_controller.start("gas_leak")
    assert status["running"] is True
    assert status["scenario"] == "gas_leak"
    assert status["total_steps"] == 1

    await _wait_idle(demo_controller, timeout=15.0)

    async with SessionLocal() as session:
        reviews = await session.execute(text("SELECT state FROM reviews"))
        states = [r[0] for r in reviews.fetchall()]
        assert states, "expected at least one review after gas_leak"
        assert any(s in ("assessing", "pending_decision") for s in states)

        facts = await session.execute(
            text(
                """
                SELECT fact_type, value FROM derived_facts
                WHERE fact_type = 'elevated_gas'
                ORDER BY computed_at DESC LIMIT 1
                """
            )
        )
        row = facts.first()
        assert row is not None
        value = row[1]
        if isinstance(value, dict):
            value = value.get("value", value)
        assert value is True or value == "true" or value is True


@pytest.mark.asyncio
async def test_concurrent_start_raises_409(ready):
    # Use a fresh controller so we can inject a never-finishing task
    ctrl = DemoController()
    ctrl._running = True
    ctrl._scenario_name = "fake"
    ctrl._task = asyncio.create_task(asyncio.sleep(60))

    with pytest.raises(ScenarioAlreadyRunningError):
        await ctrl.start("gas_leak")

    ctrl._task.cancel()
    try:
        await ctrl._task
    except (asyncio.CancelledError, Exception):  # noqa: BLE001
        pass


@pytest.mark.asyncio
async def test_reset_cancels_and_wipes(ready):
    from app.db.session import SessionLocal

    # Start a multi-step scenario so there's something to cancel mid-flight
    await demo_controller.start("compound_risk")
    # Give it a moment to emit the first (delay=0) step
    await asyncio.sleep(0.5)

    result = await demo_controller.reset()
    assert result["status"] == "reset"
    st = demo_controller.status()
    assert st["running"] is False
    assert st["scenario"] is None

    async with SessionLocal() as session:
        for table in (
            "reviews",
            "derived_facts",
            "context_entries",
            "assessments",
            "audit_entries",
        ):
            count = (
                await session.execute(text(f"SELECT count(*) FROM {table}"))
            ).scalar_one()
            assert count == 0, f"{table} should be empty after reset, got {count}"

    # Fresh start still works after reset
    status = await demo_controller.start("gas_leak")
    assert status["running"] is True
    await _wait_idle(demo_controller, timeout=15.0)
