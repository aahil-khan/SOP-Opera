"""Integration tests for DemoController start/reset/concurrency."""

from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.simulator.engine import (
    DemoController,
    ScenarioAlreadyRunningError,
    demo_controller,
)


async def _bootstrap():
    import os

    import asyncpg

    from app.core.config import get_settings
    from app.db.seed import seed_minimal
    from app.db.session import _asyncpg_dsn, apply_schema, engine
    from app.db.vector import close_vector_pool

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
    from app.db.session import engine
    from app.db.vector import close_vector_pool

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
    """
    Reset clears real runtime rows but must leave the seeded/demo corpus
    (reviews.is_seeded, scripts/quick_mock_seed.py) untouched — see
    simulator/engine.py's _RESET_DELETE_STATEMENTS and the PR #17 review
    that flagged the previous version of this test (a blanket "everything
    is 0" assertion) as encoding the old, pre-seeded-mode contract.

    A seeded review/context-entry/derived-fact is inserted here rather than
    relying on one already existing in the test DB, so this actually proves
    preservation — asserting scoped-real-rows-are-0 alone would pass just as
    well under a regression back to blanket-wipe, since there'd be nothing
    seeded to catch it deleting.

    There is no separate test database in this repo (tests run against the
    same Postgres `database_url` as local dev — see CLAUDE.md's *Tests*
    section), so everything inserted here is cleaned up in a `finally`
    regardless of outcome, and tagged with a per-run UUID marker rather than
    a fixed literal so two overlapping/failed runs can't collide.
    """
    import uuid as uuid_mod

    from app.db.session import SessionLocal

    marker = f"seeded_test_{uuid_mod.uuid4().hex[:8]}"
    seeded_review_id: object | None = None
    seeded_ctx_id: object | None = None

    try:
        async with SessionLocal() as session:
            asset_id = (
                await session.execute(text("SELECT id FROM assets LIMIT 1"))
            ).scalar_one()
            owner_id = (
                await session.execute(text("SELECT id FROM users LIMIT 1"))
            ).scalar_one()

            seeded_review_id = (
                await session.execute(
                    text(
                        """
                        INSERT INTO reviews
                            (asset_id, state, owner_id, triggered_by, is_seeded)
                        VALUES
                            (CAST(:aid AS uuid), 'closed', CAST(:oid AS uuid),
                             :marker, TRUE)
                        RETURNING id
                        """
                    ),
                    {"aid": str(asset_id), "oid": str(owner_id), "marker": marker},
                )
            ).scalar_one()

            seeded_ctx_id = (
                await session.execute(
                    text(
                        """
                        INSERT INTO context_entries
                            (asset_id, category, payload, provider,
                             valid_from, valid_until, confidence)
                        VALUES
                            (CAST(:aid AS uuid), 'sensor', '{}'::jsonb,
                             'quick_mock', now(), now() + interval '1 day', 1.0)
                        RETURNING id
                        """
                    ),
                    {"aid": str(asset_id)},
                )
            ).scalar_one()

            await session.execute(
                text(
                    """
                    INSERT INTO derived_facts
                        (asset_id, fact_type, value, source_context_ids, computed_at)
                    VALUES
                        (CAST(:aid AS uuid), :marker, 'true'::jsonb,
                         CAST(:cids AS uuid[]), now())
                    """
                ),
                {"aid": str(asset_id), "marker": marker, "cids": [str(seeded_ctx_id)]},
            )
            await session.commit()

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
            real_row_counts = {
                "reviews": "SELECT count(*) FROM reviews WHERE NOT is_seeded",
                "context_entries": "SELECT count(*) FROM context_entries WHERE provider <> 'quick_mock'",
                "assessments": (
                    "SELECT count(*) FROM assessments a JOIN reviews r "
                    "ON r.id = a.review_id WHERE NOT r.is_seeded"
                ),
            }
            for table, query in real_row_counts.items():
                count = (await session.execute(text(query))).scalar_one()
                assert count == 0, f"real {table} should be empty after reset, got {count}"

            # audit_entries has no is_seeded concept of its own (the mock
            # seeder writes none) — still wiped wholesale.
            audit_count = (
                await session.execute(text("SELECT count(*) FROM audit_entries"))
            ).scalar_one()
            assert audit_count == 0, f"audit_entries should be empty after reset, got {audit_count}"

            # The seeded rows inserted above must have survived the reset.
            seeded_review_state = (
                await session.execute(
                    text("SELECT state FROM reviews WHERE id = CAST(:id AS uuid)"),
                    {"id": str(seeded_review_id)},
                )
            ).scalar_one_or_none()
            assert seeded_review_state == "closed", (
                "seeded review should survive reset, got "
                f"{seeded_review_state!r}"
            )
            seeded_ctx_count = (
                await session.execute(
                    text(
                        "SELECT count(*) FROM context_entries WHERE id = CAST(:id AS uuid)"
                    ),
                    {"id": str(seeded_ctx_id)},
                )
            ).scalar_one()
            assert seeded_ctx_count == 1, "seeded context entry should survive reset"
            seeded_fact_count = (
                await session.execute(
                    text("SELECT count(*) FROM derived_facts WHERE fact_type = :marker"),
                    {"marker": marker},
                )
            ).scalar_one()
            assert seeded_fact_count == 1, "seeded derived fact should survive reset"

            # Reset also turns seeded mode off (see engine.py's _wipe_runtime).
            from app.db.session import get_seeded_mode

            assert get_seeded_mode() is False

        # Fresh start still works after reset
        status = await demo_controller.start("gas_leak")
        assert status["running"] is True
        await _wait_idle(demo_controller, timeout=15.0)
    finally:
        # Seeded rows survive DemoController.reset() by design (that's the
        # behavior under test), so they must be cleaned up explicitly here
        # rather than relying on reset to do it.
        async with SessionLocal() as session:
            await session.execute(
                text("DELETE FROM derived_facts WHERE fact_type = :marker"),
                {"marker": marker},
            )
            await session.execute(
                text("DELETE FROM context_entries WHERE id = CAST(:id AS uuid)"),
                {"id": str(seeded_ctx_id)} if seeded_ctx_id else {"id": str(uuid_mod.uuid4())},
            )
            await session.execute(
                text("DELETE FROM reviews WHERE triggered_by = :marker"),
                {"marker": marker},
            )
            await session.commit()


@pytest.mark.asyncio
async def test_scripted_scenario_replays_without_manual_reset(ready):
    """Second start must wipe stale facts so steps re-open reviews."""
    from app.db.session import SessionLocal

    await demo_controller.start("gas_leak")
    await _wait_idle(demo_controller, timeout=15.0)

    async with SessionLocal() as session:
        first_count = (
            await session.execute(text("SELECT count(*) FROM reviews"))
        ).scalar_one()
        assert first_count >= 1

    await demo_controller.start("gas_leak")
    await _wait_idle(demo_controller, timeout=15.0)

    async with SessionLocal() as session:
        second_count = (
            await session.execute(text("SELECT count(*) FROM reviews"))
        ).scalar_one()
        assert second_count >= 1
        states = [
            r[0]
            for r in (
                await session.execute(text("SELECT state FROM reviews"))
            ).fetchall()
        ]
        assert any(s in ("assessing", "pending_decision", "opened") for s in states)
