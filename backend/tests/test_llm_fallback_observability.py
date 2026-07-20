"""LLM fallback observability — agent trace + ai_ops_events."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.agents.llm_outcomes import summarize_llm_outcomes
from app.agents.nodes.orchestrator import orchestrator_agent
from app.agents.nodes.source import scada_agent
from app.agents.state import AgentState


def _base_state(**overrides) -> AgentState:
    state: AgentState = {
        "review_id": str(uuid4()),
        "assessment_id": str(uuid4()),
        "asset_id": "11111111-1111-1111-1111-111111111111",
        "asset_name": "Vessel A",
        "asset_zone": "coke-oven-battery",
        "fact_types": ["elevated_gas"],
        "facts": [],
        "context_entries": [
            {
                "id": str(uuid4()),
                "category": "sensor",
                "payload": {"gas_reading": 28.0},
            }
        ],
        "plant_context_entries": [],
        "retrieved_references": [],
        "observations": [],
        "agent_trace": [],
        "spatial_links": [],
        "incident_echoes": [],
        "shift_handover_note": None,
        "verdict": None,
        "grounded_fact_types": [],
        "provider_name": "openai_compatible",
        "llm_usage": [],
        "llm_outcomes": [],
    }
    state.update(overrides)
    return state


def test_summarize_llm_outcomes_ignores_mock_provider():
    stats = summarize_llm_outcomes(
        [{"agent": "scada", "status": "fallback", "reason": "401"}],
        provider="mock",
    )
    assert stats == {
        "llm_attempt_count": 0,
        "llm_fallback_count": 0,
        "degraded": False,
    }


def test_summarize_llm_outcomes_counts_live_fallbacks():
    outcomes = [
        {"agent": "scada", "status": "fallback", "reason": "401"},
        {"agent": "orchestrator", "status": "ok"},
    ]
    stats = summarize_llm_outcomes(outcomes, provider="openai_compatible")
    assert stats["llm_attempt_count"] == 2
    assert stats["llm_fallback_count"] == 1
    assert stats["degraded"] is True


@pytest.mark.asyncio
async def test_source_agent_trace_records_llm_fallback(monkeypatch):
    class _BoomModel:
        async def ainvoke(self, prompt: str):
            raise RuntimeError("401 invalid api key")

    monkeypatch.setattr(
        "app.agents.nodes.source.get_chat_model",
        lambda _p=None: _BoomModel(),
    )
    out = await scada_agent(_base_state())
    trace = out["agent_trace"]
    assert any(
        s.get("kind") == "error"
        and "template" in str(s.get("message", "")).lower()
        for s in trace
    )
    assert out["llm_outcomes"][0]["status"] == "fallback"


@pytest.mark.asyncio
async def test_orchestrator_trace_records_summary_fallback(monkeypatch):
    class _BoomModel:
        async def ainvoke(self, prompt: str):
            raise RuntimeError("401 invalid api key")

    monkeypatch.setattr(
        "app.agents.nodes.orchestrator.get_chat_model",
        lambda _p=None: _BoomModel(),
    )
    state = _base_state(
        observations=[
            {
                "agent": "scada",
                "observation": "Gas elevated",
                "local_risk": "elevated",
                "fact_types": ["elevated_gas"],
                "detail": {},
            }
        ]
    )
    out = await orchestrator_agent(state, provider_name="openai_compatible")
    trace = out["agent_trace"]
    assert any(
        s.get("kind") == "error"
        and "summary" in str(s.get("message", "")).lower()
        for s in trace
    )
    assert out["verdict"]["risk_level"] in ("elevated", "blocking", "nominal")
    assert out["llm_outcomes"][0]["status"] == "fallback"
