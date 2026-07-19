"""Unit tests for context/risk agent routing gates."""

from __future__ import annotations

from uuid import uuid4

from app.agents.routing import (
    select_source_agents,
    should_load_plant_neighborhood,
    should_run_enrichment,
    should_run_spatial,
)


def _state(**overrides):
    base = {
        "fact_types": [],
        "context_entries": [],
        "plant_context_entries": [],
        "observations": [],
        "verdict": None,
    }
    base.update(overrides)
    return base


def test_select_source_agents_by_facts():
    selected = select_source_agents(
        _state(fact_types=["elevated_gas", "zone_occupied", "permit_conflict"])
    )
    assert selected == ["scada", "permit", "workforce"]


def test_select_source_agents_by_context_category():
    selected = select_source_agents(
        _state(
            context_entries=[
                {
                    "id": str(uuid4()),
                    "category": "isolation_status",
                    "payload": {"isolation_confirmed": False},
                }
            ]
        )
    )
    assert selected == ["maintenance"]


def test_select_source_agents_empty():
    assert select_source_agents(_state()) == []


def test_should_run_spatial_on_elevated_observation():
    assert should_run_spatial(
        _state(
            observations=[
                {
                    "agent": "scada",
                    "observation": "elevated",
                    "local_risk": "elevated",
                    "fact_types": ["elevated_gas"],
                    "detail": {},
                }
            ]
        )
    )


def test_should_run_spatial_on_hot_work_permit():
    assert should_run_spatial(
        _state(
            context_entries=[
                {
                    "category": "permit",
                    "payload": {"status": "active", "work_type": "hot_work"},
                }
            ]
        )
    )


def test_should_not_run_spatial_when_nominal():
    assert not should_run_spatial(_state())


def test_should_run_enrichment_on_elevated_verdict():
    assert should_run_enrichment(_state(verdict={"risk_level": "elevated"}))
    assert should_run_enrichment(_state(verdict={"risk_level": "blocking"}))
    assert not should_run_enrichment(_state(verdict={"risk_level": "nominal"}))
    assert not should_run_enrichment(_state(verdict=None))


def test_should_load_plant_neighborhood():
    assert should_load_plant_neighborhood(["elevated_gas"], [])
    assert should_load_plant_neighborhood(
        [],
        [{"category": "permit", "payload": {"status": "active", "work_type": "hot_work"}}],
    )
    assert not should_load_plant_neighborhood([], [])
    assert not should_load_plant_neighborhood(["certification_expiring"], [])
