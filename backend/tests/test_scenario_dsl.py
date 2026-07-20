"""Unit / light-integration tests for the YAML Scenario DSL."""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio

from app.simulator.dsl import (
    ScenarioNotFoundError,
    list_scenario_names,
    load_scenario,
    resolve_asset_id,
)


KNOWN_SCENARIOS = frozenset(
    {
        "gas_leak",
        "permit_conflict",
        "compound_risk",
        "spatial_proximity",
        "vsp_coke_oven",
    }
)


def test_list_scenario_names_includes_known():
    names = set(list_scenario_names())
    assert KNOWN_SCENARIOS.issubset(names)


def test_load_all_scenarios():
    for name in sorted(KNOWN_SCENARIOS):
        scenario = load_scenario(name)
        assert scenario.name == name
        assert scenario.label
        assert len(scenario.steps) >= 1
        for step in scenario.steps:
            assert step.category
            assert isinstance(step.payload, dict)


def test_vsp_coke_oven_stays_subcritical_until_final_step():
    """Hero story: compound facts assemble while gas is still below critical."""
    from app.core.config import get_settings

    settings = get_settings()
    assert settings.gas_critical_threshold > settings.gas_elevated_threshold

    scenario = load_scenario("vsp_coke_oven")
    gas_steps = [
        s for s in scenario.steps if s.category == "sensor" and "gas_reading" in s.payload
    ]
    assert len(gas_steps) >= 2
    # All but the last gas sample stay below the single-sensor incident line.
    for step in gas_steps[:-1]:
        assert float(step.payload["gas_reading"]) < settings.gas_critical_threshold
        assert float(step.payload["gas_reading"]) > settings.gas_elevated_threshold
    assert float(gas_steps[-1].payload["gas_reading"]) >= settings.gas_critical_threshold

    categories = {s.category for s in scenario.steps}
    assert "permit" in categories
    assert "worker_location" in categories


def test_unknown_scenario_raises():
    with pytest.raises(ScenarioNotFoundError):
        load_scenario("does_not_exist")


def test_path_traversal_rejected():
    with pytest.raises(ScenarioNotFoundError):
        load_scenario("../secrets")


@pytest_asyncio.fixture
async def session():
    from app.core.config import get_settings
    from app.db.session import SessionLocal, apply_schema, engine, _asyncpg_dsn
    from app.db.vector import close_vector_pool
    from app.db.seed import seed_minimal
    import asyncpg

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()

    async with SessionLocal() as s:
        yield s
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_resolve_asset_by_name(session):
    aid = await resolve_asset_id(session, "Vessel A")
    assert aid == UUID("11111111-1111-1111-1111-111111111111")


@pytest.mark.asyncio
async def test_resolve_asset_by_uuid(session):
    raw = "33333333-3333-3333-3333-333333333333"
    aid = await resolve_asset_id(session, raw)
    assert aid == UUID(raw)


@pytest.mark.asyncio
async def test_resolve_asset_unknown_raises(session):
    with pytest.raises(LookupError):
        await resolve_asset_id(session, "No Such Asset")
