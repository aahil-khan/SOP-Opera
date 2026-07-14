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


def test_list_scenario_names_has_three():
    names = list_scenario_names()
    assert set(names) == {"gas_leak", "permit_conflict", "compound_risk"}


def test_load_all_scenarios():
    for name in ("gas_leak", "permit_conflict", "compound_risk"):
        scenario = load_scenario(name)
        assert scenario.name == name
        assert scenario.label
        assert len(scenario.steps) >= 1
        for step in scenario.steps:
            assert step.category
            assert isinstance(step.payload, dict)


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
