"""Unit tests for LangGraph agent core + rule tools (no DB required)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.agents.graph import reset_compiled_graph, run_agent_assessment
from app.agents.tools.rules import RuleToolkit, require_grounding_for_block
from shared.python.schemas import DerivedFact


@pytest.fixture(autouse=True)
def _fresh_graph():
    reset_compiled_graph()
    yield
    reset_compiled_graph()


def test_rule_toolkit_known_facts():
    toolkit = RuleToolkit(known_true_facts=["elevated_gas", "zone_occupied"])
    assert toolkit.check("elevated_gas").active is True
    assert toolkit.check("permit_conflict").active is False
    assert toolkit.active_for_agent("scada") == ["elevated_gas"]
    assert toolkit.active_for_agent("workforce") == ["zone_occupied"]
    assert "elevated_gas" in toolkit.all_active()


def test_require_grounding_downgrades_ungrounded_block():
    assert require_grounding_for_block("blocking", []) == "nominal"
    assert require_grounding_for_block("blocking", ["elevated_gas"]) == "blocking"
    assert require_grounding_for_block("elevated", []) == "elevated"


@pytest.mark.asyncio
async def test_langgraph_compound_risk_blocking():
    asset_id = UUID("11111111-1111-1111-1111-111111111111")
    now = datetime.now(timezone.utc)
    facts = [
        DerivedFact(
            id=uuid4(),
            asset_id=asset_id,
            fact_type=ft,
            value=True,
            computed_at=now,
            source_context_ids=[],
        )
        for ft in ("elevated_gas", "permit_conflict", "zone_occupied")
    ]
    generation, trace, _links, _stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=asset_id,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=facts,
        context_entries=[],
        retrieved_references=[],
        provider_name="mock",
    )
    assert generation.result.risk_level == "blocking"
    assert generation.provider.startswith("langgraph:")
    agents = {s["agent"] for s in trace}
    assert {
        "scada",
        "permit",
        "workforce",
        "orchestrator",
        "spatial",
        "incident_pattern",
    } <= agents
    assert "maintenance" not in agents
    # The handover agent is gated on carry-forward loaded from the DB, not on the
    # verdict, so a blocking asset with a clean handover does not run it.
    assert "shift_handover" not in agents
    assert any(s["kind"] == "verdict" for s in trace)
    assert (
        "Multi-agent" in generation.result.summary
        or "grounded" in generation.result.summary.lower()
        or "Vessel A" in generation.result.summary
    )


@pytest.mark.asyncio
async def test_langgraph_nominal_when_no_facts():
    asset_id = UUID("11111111-1111-1111-1111-111111111111")
    generation, trace, _links, _stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=asset_id,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=[],
        context_entries=[],
        retrieved_references=[],
        provider_name="mock",
    )
    assert generation.result.risk_level == "nominal"
    agents = {s["agent"] for s in trace}
    assert agents == {"orchestrator"}
    assert "incident_pattern" not in agents
    assert "shift_handover" not in agents
    assert "scada" not in agents


@pytest.mark.asyncio
async def test_investigation_node_is_verdict_safe():
    """The investigation enrichment node advises but cannot move the verdict."""
    from app.agents.nodes.investigation import investigation_agent

    state = {
        "review_id": str(uuid4()),
        "assessment_id": str(uuid4()),
        "asset_name": "Vessel A",
        "grounded_fact_types": ["elevated_gas", "incomplete_isolation"],
        "verdict": {"risk_level": "blocking", "summary": "x", "recommendations": []},
        "incident_echoes": [{"title": "VSP-pattern near-miss"}],
        "retrieved_references": [],
        "provider_name": "mock",
    }
    out = await investigation_agent(state)

    # It emits a visible advisory for the Brain panel...
    assert out["observations"][0]["agent"] == "investigation"
    assert out["observations"][0]["observation"].strip()
    assert out["observations"][0]["local_risk"] == "nominal"  # never escalates
    # ...but structurally cannot write any key that carries the verdict.
    for forbidden in ("verdict", "risk_level", "grounded_fact_types", "recommendations"):
        assert forbidden not in out
    # Mock mode makes no LLM call.
    assert "llm_usage" not in out


@pytest.mark.asyncio
async def test_investigation_node_nominal_needs_no_conditions():
    from app.agents.nodes.investigation import investigation_agent

    out = await investigation_agent(
        {
            "asset_name": "Vessel A",
            "grounded_fact_types": [],
            "verdict": {"risk_level": "nominal"},
            "provider_name": "mock",
        }
    )
    assert "routine monitoring" in out["observations"][0]["observation"].lower()
