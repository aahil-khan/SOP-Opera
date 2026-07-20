"""Unit tests for LLM usage extraction and graph token accumulation."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.agents.graph import reset_compiled_graph, run_agent_assessment
from app.agents.llm import (
    estimate_cost_usd,
    extract_usage,
    sum_usage,
    usage_record,
)
from shared.python.schemas import DerivedFact


def test_extract_usage_from_usage_metadata():
    resp = SimpleNamespace(
        usage_metadata={"input_tokens": 12, "output_tokens": 34},
        response_metadata={},
    )
    assert extract_usage(resp) == (12, 34)


def test_extract_usage_from_openai_token_usage():
    resp = SimpleNamespace(
        usage_metadata=None,
        response_metadata={
            "token_usage": {"prompt_tokens": 10, "completion_tokens": 5}
        },
    )
    assert extract_usage(resp) == (10, 5)


def test_extract_usage_from_ollama_counts():
    resp = SimpleNamespace(
        usage_metadata=None,
        response_metadata={"prompt_eval_count": 20, "eval_count": 8},
    )
    assert extract_usage(resp) == (20, 8)


def test_extract_usage_missing_returns_zeros():
    assert extract_usage(None) == (0, 0)
    assert extract_usage(SimpleNamespace()) == (0, 0)


def test_estimate_cost_openai_vs_ollama():
    assert estimate_cost_usd("openai", "gpt-4o-mini", 1_000_000, 0) == pytest.approx(
        0.15
    )
    assert estimate_cost_usd("ollama", "llama3.2", 1_000_000, 1_000_000) == 0.0
    assert estimate_cost_usd("mock", "x", 100, 100) == 0.0


def test_sum_usage():
    tin, tout, cost = sum_usage(
        [
            {"input_tokens": 10, "output_tokens": 2, "estimated_cost_usd": 0.001},
            {"input_tokens": 5, "output_tokens": 3, "estimated_cost_usd": 0.0},
        ]
    )
    assert tin == 15
    assert tout == 5
    assert cost == pytest.approx(0.001)


def test_usage_record_builds_entry():
    resp = SimpleNamespace(
        usage_metadata={"input_tokens": 7, "output_tokens": 3},
        response_metadata={},
    )
    rec = usage_record(agent="scada", response=resp, provider_name="ollama")
    assert rec["agent"] == "scada"
    assert rec["input_tokens"] == 7
    assert rec["output_tokens"] == 3
    assert rec["provider"] == "ollama"
    assert rec["estimated_cost_usd"] == 0.0


@pytest.fixture(autouse=True)
def _fresh_graph():
    reset_compiled_graph()
    yield
    reset_compiled_graph()


@pytest.mark.asyncio
async def test_graph_accumulates_usage_from_llm(monkeypatch):
    class _FakeModel:
        async def ainvoke(self, prompt: str):
            return SimpleNamespace(
                content="Elevated gas on Vessel A requires stop-work.",
                usage_metadata={"input_tokens": 40, "output_tokens": 15},
                response_metadata={},
            )

    monkeypatch.setattr(
        "app.agents.nodes.source.get_chat_model",
        lambda _p=None: _FakeModel(),
    )
    monkeypatch.setattr(
        "app.agents.nodes.orchestrator.get_chat_model",
        lambda _p=None: _FakeModel(),
    )

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
    generation, _trace, _links, _stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=asset_id,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=facts,
        context_entries=[
            {
                "id": str(uuid4()),
                "category": "sensor",
                "payload": {"gas_reading": 28.0},
            }
        ],
        retrieved_references=[],
        provider_name="openai",
    )
    # scada narration + orchestrator summary each contribute 40/15
    assert generation.input_tokens == 80
    assert generation.output_tokens == 30
    assert generation.estimated_cost_usd > 0
    # Not the old fake formula (80 + 15 * facts = 95)
    assert generation.input_tokens != 80 + 15 * len(facts)


@pytest.mark.asyncio
async def test_graph_mock_has_zero_tokens():
    asset_id = UUID("11111111-1111-1111-1111-111111111111")
    generation, _trace, _links, _stats = await run_agent_assessment(
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
    assert generation.input_tokens == 0
    assert generation.output_tokens == 0
    assert generation.estimated_cost_usd == 0.0
