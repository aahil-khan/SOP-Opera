"""Tests for source narration, orch citations, and ref serialization."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.agents.graph import _serialize_ref, reset_compiled_graph, run_agent_assessment
from app.agents.nodes.orchestrator import _build_summary_prompt, _mock_summary
from app.agents.nodes.source import scada_agent
from app.agents.state import AgentState
from shared.python.schemas import DerivedFact, RetrievedReference


@pytest.fixture(autouse=True)
def _fresh_graph():
    reset_compiled_graph()
    yield
    reset_compiled_graph()


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
        "trend_forecasts": [],
        "incident_echoes": [],
        "carried_handover_items": [],
        "verdict": None,
        "grounded_fact_types": [],
        "provider_name": "mock",
        "llm_usage": [],
        "llm_outcomes": [],
    }
    state.update(overrides)
    return state


def test_serialize_ref_keeps_title_and_triggered_by():
    ref = RetrievedReference(
        source="historical_incidents",
        id=uuid4(),
        retrieval_path="rag",
        score=0.95,
        title="VSP near-miss",
        snippet="Gas + hot work",
        code=None,
        triggered_by_fact="elevated_gas",
    )
    out = _serialize_ref(ref)
    assert out["title"] == "VSP near-miss"
    assert out["triggered_by_fact"] == "elevated_gas"
    assert out["snippet"] == "Gas + hot work"


@pytest.mark.asyncio
async def test_source_agent_uses_template_under_mock():
    out = await scada_agent(_base_state(provider_name="mock"))
    obs = out["observations"][0]["observation"]
    assert "28" in obs
    assert "20" in obs  # elevated gas threshold
    assert "Vessel A" in obs
    assert out["observations"][0]["agent"] == "scada"


@pytest.mark.asyncio
async def test_source_agent_temp_observation_includes_reading_and_limit():
    sensor_id = str(uuid4())
    out = await scada_agent(
        _base_state(
            provider_name="mock",
            fact_types=["over_temperature"],
            asset_name="ETP",
            context_entries=[
                {
                    "id": sensor_id,
                    "category": "sensor",
                    "payload": {"temp_reading": 92.0, "unit": "C"},
                }
            ],
        )
    )
    obs = out["observations"][0]["observation"]
    assert "92" in obs
    assert "80" in obs
    assert "ETP" in obs
    assert "above safe band" not in obs.lower()


@pytest.mark.asyncio
async def test_source_agent_uses_llm_text_when_model_available(monkeypatch):
    class _FakeModel:
        async def ainvoke(self, prompt: str):
            return SimpleNamespace(
                content="SCADA sees CO above the action band at Vessel A."
            )

    monkeypatch.setattr(
        "app.agents.nodes.source.get_chat_model",
        lambda _p=None: _FakeModel(),
    )
    out = await scada_agent(_base_state(provider_name="openai"))
    assert "CO above the action band" in out["observations"][0]["observation"]
    assert "28 ppm" not in out["observations"][0]["observation"]


@pytest.mark.asyncio
async def test_source_clearance_skips_llm(monkeypatch):
    called = {"n": 0}

    class _FakeModel:
        async def ainvoke(self, prompt: str):
            called["n"] += 1
            return SimpleNamespace(content="should not be used")

    monkeypatch.setattr(
        "app.agents.nodes.source.get_chat_model",
        lambda _p=None: _FakeModel(),
    )
    out = await scada_agent(
        _base_state(fact_types=[], context_entries=[{"category": "sensor", "payload": {}}])
    )
    assert called["n"] == 0
    assert "no active hazards" in out["observations"][0]["observation"].lower()


def test_build_summary_prompt_includes_refs_and_fuse_instruction():
    state = _base_state(
        retrieved_references=[
            {
                "source": "historical_incidents",
                "title": "Battery gas near-miss",
                "snippet": "Workers stayed during alarm.",
                "code": None,
            },
            {
                "source": "regulations",
                "title": "Gas work permit rule",
                "snippet": "Isolate before hot work.",
                "code": "REG-12",
            },
        ],
        observations=[
            {
                "agent": "scada",
                "observation": "SCADA: elevated gas.",
                "local_risk": "elevated",
                "fact_types": ["elevated_gas"],
                "detail": {},
            }
        ],
    )
    prompt = _build_summary_prompt(
        state, ["elevated_gas"], "elevated", state["observations"]
    )
    assert "do not paste domain observations back verbatim" in prompt.lower()
    assert "Battery gas near-miss" in prompt
    assert "REG-12" in prompt
    assert "scada: SCADA: elevated gas." in prompt.lower() or "scada:" in prompt.lower()


def test_build_summary_prompt_supervisor_only_uses_tight_prompt():
    state = _base_state(
        fact_types=["supervisor_safety_hazard"],
        asset_name="Gas Cleaning Plant",
        context_entries=[
            {
                "category": "supervisor_report",
                "payload": {
                    "description": "one of the valves is leaking",
                    "reported_by": "Asha Rao",
                    "concern_type": "safety_hazard",
                },
                "valid_from": "2026-01-01T00:00:00Z",
            }
        ],
        observations=[],
    )
    prompt = _build_summary_prompt(
        state, ["supervisor_safety_hazard"], "blocking", []
    )
    assert "synthesize the compound risk in 3-5 sentences" not in prompt.lower()
    assert "do not invent" in prompt.lower()
    assert "one of the valves is leaking" in prompt
    assert "Asha Rao" in prompt


def test_build_summary_prompt_mixed_facts_keeps_compound_mode():
    state = _base_state(
        fact_types=["supervisor_safety_hazard", "elevated_gas"],
        context_entries=[
            {
                "category": "supervisor_report",
                "payload": {
                    "description": "one of the valves is leaking",
                    "reported_by": "Asha Rao",
                    "concern_type": "safety_hazard",
                },
                "valid_from": "2026-01-01T00:00:00Z",
            }
        ],
        observations=[
            {
                "agent": "scada",
                "observation": "Gas reading exceeds action threshold.",
                "local_risk": "elevated",
                "fact_types": ["elevated_gas"],
                "detail": {},
            }
        ],
    )
    prompt = _build_summary_prompt(
        state,
        ["supervisor_safety_hazard", "elevated_gas"],
        "blocking",
        state["observations"],
    )
    assert "synthesize the compound risk in 3-5 sentences" in prompt.lower()
    assert "do not invent additional causes" in prompt.lower()


def test_mock_summary_appends_incident_title():
    state = _base_state(
        retrieved_references=[
            {
                "source": "historical_incidents",
                "title": "Battery gas near-miss",
                "snippet": "…",
            }
        ]
    )
    summary = _mock_summary(state, ["elevated_gas"], "elevated", [])
    assert "Battery gas near-miss" in summary


@pytest.mark.asyncio
async def test_graph_incident_keeps_serialized_title():
    asset_id = UUID("11111111-1111-1111-1111-111111111111")
    now = datetime.now(timezone.utc)
    facts = [
        DerivedFact(
            id=uuid4(),
            asset_id=asset_id,
            fact_type="elevated_gas",
            value=True,
            computed_at=now,
            source_context_ids=[],
        )
    ]
    ref = RetrievedReference(
        source="historical_incidents",
        id=uuid4(),
        retrieval_path="rag",
        score=0.94,
        title="Corpus near-miss title",
        snippet="Echoed from enrich.",
        triggered_by_fact="elevated_gas",
    )
    _gen, trace, _links, _stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=asset_id,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=facts,
        context_entries=[
            {
                "id": str(uuid4()),
                "asset_id": str(asset_id),
                "category": "sensor",
                "payload": {"gas_reading": 28.0},
            }
        ],
        retrieved_references=[ref],
        provider_name="mock",
    )
    messages = " ".join(s.get("message") or "" for s in trace)
    assert "Corpus near-miss title" in messages
    assert "prior near-miss" not in messages or "Corpus near-miss title" in messages
