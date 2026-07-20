"""Tests for Incident Pattern + Shift Handover agents."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.agents.graph import reset_compiled_graph, run_agent_assessment
from app.agents.nodes.incident_pattern import incident_pattern_agent
from app.agents.nodes.shift_handover import _mock_brief, shift_handover_agent
from app.agents.state import AgentState
from shared.python.schemas import DerivedFact

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture(autouse=True)
def _reset_graph():
    reset_compiled_graph()
    yield
    reset_compiled_graph()


def _base_state(**overrides) -> AgentState:
    state: AgentState = {
        "review_id": str(uuid4()),
        "assessment_id": str(uuid4()),
        "asset_id": str(VESSEL_A),
        "asset_name": "Vessel A",
        "asset_zone": "coke-oven-battery",
        "fact_types": ["elevated_gas"],
        "facts": [],
        "context_entries": [],
        "plant_context_entries": [],
        "retrieved_references": [],
        "observations": [],
        "agent_trace": [],
        "spatial_links": [],
        "incident_echoes": [],
        "shift_handover_note": None,
        "verdict": None,
        "grounded_fact_types": [],
        "provider_name": "mock",
        "llm_usage": [],
        "llm_outcomes": [],
    }
    state.update(overrides)
    return state


@pytest.mark.asyncio
async def test_incident_pattern_prefers_titled_ref():
    untitled = {
        "id": str(uuid4()),
        "source": "historical_incidents",
        "title": None,
        "snippet": "untitled snippet",
        "retrieval_path": "rag",
        "score": 0.99,
    }
    titled = {
        "id": str(uuid4()),
        "source": "historical_incidents",
        "title": "Named near-miss",
        "snippet": "with a title",
        "retrieval_path": "rag",
        "score": 0.8,
    }
    out = await incident_pattern_agent(
        _base_state(retrieved_references=[untitled, titled])
    )
    assert "Named near-miss" in out["observations"][0]["observation"]
    assert out["incident_echoes"][0]["title"] is None  # list order preserved
    assert "VSP-pattern" not in out["observations"][0]["observation"]


@pytest.mark.asyncio
async def test_incident_pattern_fallback_echo():
    out = await incident_pattern_agent(_base_state())
    assert out["observations"][0]["agent"] == "incident_pattern"
    assert "echo" in out["observations"][0]["observation"].lower()
    assert out["incident_echoes"]
    assert out["incident_echoes"][0]["triggered_by_fact"] == "elevated_gas"


@pytest.mark.asyncio
async def test_incident_pattern_uses_retrieved_refs():
    refs = [
        {
            "id": str(uuid4()),
            "source": "historical_incidents",
            "title": "Custom near-miss",
            "snippet": "Gas + hot work co-occurrence.",
            "retrieval_path": "rag",
            "score": 0.95,
            "triggered_by_fact": "elevated_gas",
        }
    ]
    out = await incident_pattern_agent(_base_state(retrieved_references=refs))
    assert "Custom near-miss" in out["observations"][0]["observation"]
    assert out["incident_echoes"][0]["retrieval_path"] == "rag"


@pytest.mark.asyncio
async def test_shift_handover_in_graph_note():
    out = await shift_handover_agent(_base_state(fact_types=["elevated_gas", "zone_occupied"]))
    assert out["shift_handover_note"]
    assert "elevated_gas" in out["shift_handover_note"]


def test_mock_brief_structure():
    brief = _mock_brief(
        asset_summaries=["Vessel A [sensor] gas_reading=25"],
        open_reviews=["Vessel A state=pending_decision"],
        active_facts=["Vessel A:elevated_gas"],
        window_hours=12,
    )
    assert "Shift Safety Brief" in brief
    assert "elevated_gas" in brief


@pytest.mark.asyncio
async def test_full_graph_includes_incident_and_handover():
    now = datetime.now(timezone.utc)
    facts = [
        DerivedFact(
            id=uuid4(),
            asset_id=VESSEL_A,
            fact_type="elevated_gas",
            value=True,
            computed_at=now,
            source_context_ids=[],
        )
    ]
    generation, trace, _links, _stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=VESSEL_A,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=facts,
        context_entries=[
            {
                "id": str(uuid4()),
                "asset_id": str(VESSEL_A),
                "category": "sensor",
                "payload": {"gas_reading": 28.0},
            },
            {
                "id": str(uuid4()),
                "asset_id": str(VESSEL_A),
                "category": "permit",
                "payload": {
                    "permit_id": "p-hot",
                    "status": "active",
                    "work_type": "hot_work",
                },
            },
        ],
        retrieved_references=[],
        provider_name="mock",
    )
    agents = {s["agent"] for s in trace}
    assert "incident_pattern" in agents
    assert "shift_handover" in agents
    assert "scada" in agents
    assert "permit" in agents
    assert generation.result.risk_level in ("elevated", "blocking")
    assert any("echo" in (s.get("message") or "").lower() for s in trace)


@pytest.mark.asyncio
async def test_full_graph_skips_enrichment_when_nominal():
    generation, trace, _links, _stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=VESSEL_A,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=[],
        context_entries=[],
        retrieved_references=[],
        provider_name="mock",
    )
    agents = {s["agent"] for s in trace}
    assert generation.result.risk_level == "nominal"
    assert "incident_pattern" not in agents
    assert "shift_handover" not in agents
    assert "spatial" not in agents
