"""Unit tests for LangGraph agent core + rule tools (no DB required)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.agents.graph import run_agent_assessment
from app.agents.tools.rules import RuleToolkit, require_grounding_for_block
from shared.python.schemas import DerivedFact


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
    generation, trace, _links = await run_agent_assessment(
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
        "maintenance",
        "workforce",
        "orchestrator",
        "spatial",
        "incident_pattern",
        "shift_handover",
    } <= agents
    assert any(s["kind"] == "verdict" for s in trace)
    assert "Multi-agent" in generation.result.summary or "grounded" in generation.result.summary.lower() or "Vessel A" in generation.result.summary


@pytest.mark.asyncio
async def test_langgraph_nominal_when_no_facts():
    asset_id = UUID("11111111-1111-1111-1111-111111111111")
    generation, trace, _links = await run_agent_assessment(
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
    assert len(trace) >= 5
