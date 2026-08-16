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
    """Eval hero: compound facts assemble while gas is still below critical."""
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


def test_compound_risk_demo_story_is_paced_and_subcritical():
    """Live demo hero: gas → unisolated hot work → worker; no critical climb."""
    from app.core.config import get_settings
    from app.risk.policy import classify
    from app.simulator.dsl import step_display_label

    settings = get_settings()
    scenario = load_scenario("compound_risk")
    assert len(scenario.steps) == 4

    categories = [s.category for s in scenario.steps]
    assert categories == ["sensor", "permit", "worker_location", "permit"]
    assert all(step_display_label(s) for s in scenario.steps)

    gas = scenario.steps[0]
    assert float(gas.payload["gas_reading"]) > settings.gas_elevated_threshold
    assert float(gas.payload["gas_reading"]) < settings.gas_critical_threshold
    # Every gas sample in the demo stays sub-critical (no late re-break).
    for step in scenario.steps:
        if step.category == "sensor" and "gas_reading" in step.payload:
            assert float(step.payload["gas_reading"]) < settings.gas_critical_threshold

    hot = scenario.steps[1]
    assert hot.payload.get("work_type") == "hot_work"
    assert "isolation_confirmed" not in hot.payload

    # Pathway completes at the hot-work step (before the worker arrives).
    assert classify(["elevated_gas"]).level == "elevated"
    assert classify(["elevated_gas", "incomplete_isolation"]).level == "blocking"
    assert classify(
        ["elevated_gas", "incomplete_isolation", "zone_occupied"]
    ).level == "blocking"


def test_unknown_scenario_raises():
    with pytest.raises(ScenarioNotFoundError):
        load_scenario("does_not_exist")


def test_path_traversal_rejected():
    with pytest.raises(ScenarioNotFoundError):
        load_scenario("../secrets")


@pytest_asyncio.fixture
async def session():
    import asyncpg

    from app.core.config import get_settings
    from app.db.seed import seed_minimal
    from app.db.session import SessionLocal, _asyncpg_dsn, apply_schema, engine
    from app.db.vector import close_vector_pool

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
