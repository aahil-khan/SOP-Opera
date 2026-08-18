"""
Model bench (W9b) — pure-logic checks plus a real mock-provider run.

Fast and network-free: the mock provider makes no LLM call, so this exercises the
whole bench path in milliseconds. The Ollama/OpenAI legs are exercised by running
the module directly; the suite must not depend on a model server.
"""

from __future__ import annotations

import asyncio

import pytest

from app.assessment.citations import aggregate_strip_stats, stripped_citations_in_trace
from app.eval.model_bench import (
    BenchReport,
    ProviderResult,
    bench_cases,
    provider_available,
    run_bench,
)


def test_bench_cases_are_fixed_and_non_empty():
    cases = bench_cases(6)
    assert 1 <= len(cases) <= 6
    assert len(cases) == len({c.case_id for c in cases})


def test_mock_provider_is_always_available():
    ok, reason = provider_available("mock")
    assert ok and reason is None


def test_openai_leg_is_reported_not_run_without_a_key(monkeypatch):
    """The blocker must be visible as a blocker, never filled in with numbers."""
    from app.core.config import get_settings

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(get_settings(), "openai_api_key", "")

    ok, reason = provider_available("openai_compatible")
    assert ok is False
    assert reason is not None and "OPENAI_API_KEY" in reason


def test_not_run_provider_emits_no_numbers():
    report = BenchReport(
        providers=[
            ProviderResult(
                provider="openai_compatible", status="not_run", note="no key"
            )
        ],
        cases=["x"],
        repeats=1,
        generated_at="2026-08-15T00:00:00Z",
    )
    row = report.to_json()["providers"][0]
    assert row["status"] == "NOT RUN"
    assert "latency_ms" not in row
    assert "mean_cost_usd_per_assessment" not in row
    assert "NOT RUN" in report.to_markdown()


def test_strip_stats_recovered_from_a_persisted_trace():
    """The guard's interventions must be measurable after the fact."""
    trace = [
        {"agent": "orchestrator", "kind": "started", "detail": {}},
        {
            "agent": "orchestrator",
            "kind": "error",
            "detail": {
                "unsupported_citations": ["OISD-STD-999"],
                "supported_citations": ["OISD-STD-105"],
            },
        },
    ]
    assert stripped_citations_in_trace(trace) == ["OISD-STD-999"]

    stats = aggregate_strip_stats([trace, []], summaries=[None, "clean prose"])
    assert stats.assessments == 2
    assert stats.assessments_with_strip == 1
    assert stats.stripped_tokens == 1
    assert stats.cited_tokens == 2
    assert stats.strip_rate == 0.5
    assert stats.token_strip_rate == 0.5


def test_strip_stats_of_nothing_is_zero_not_a_crash():
    stats = aggregate_strip_stats([])
    assert stats.assessments == 0
    assert stats.strip_rate == 0.0
    assert stats.token_strip_rate == 0.0


@pytest.mark.asyncio
async def test_bench_runs_end_to_end_on_mock_and_reports_invariance(monkeypatch):
    # The NOT RUN leg has to be forced, not assumed. `provider_available()` asks
    # `check_provider()`, which reports openai_compatible as usable whenever
    # `OPENAI_API_KEY` is set — and Settings reads the repo-root `.env`. On a
    # machine with a key this test used to run three live, billable OpenAI
    # requests before failing its own assertion, against this file's stated
    # contract that the suite is network-free.
    from app.eval import model_bench

    real_available = model_bench.provider_available
    monkeypatch.setattr(
        model_bench,
        "provider_available",
        lambda provider: (
            (False, "no OPENAI_API_KEY configured")
            if provider == "openai_compatible"
            else real_available(provider)
        ),
    )

    report = await run_bench(["mock", "openai_compatible"], repeats=1, case_limit=3)

    mock = next(p for p in report.providers if p.provider == "mock")
    assert mock.status == "measured"
    assert len(mock.successes) == len(mock.runs) == 3
    assert mock.failure_rate == 0.0
    assert mock.latency.p50_ms is not None and mock.latency.p95_ms is not None

    openai_leg = next(
        p for p in report.providers if p.provider == "openai_compatible"
    )
    assert openai_leg.status == "not_run"

    table, consistent = report.invariance()
    assert consistent, table
    # Every measured case produced a verdict from the policy, not from the model.
    assert all(row["mock"] in ("nominal", "elevated", "blocking") for row in table.values())


@pytest.mark.asyncio
async def test_verdict_is_identical_across_repeats_on_mock():
    """The invariance claim starts with run-to-run stability on one provider."""
    report = await run_bench(["mock"], repeats=2, case_limit=3)
    mock = report.providers[0]
    per_case: dict[str, set[str | None]] = {}
    for r in mock.successes:
        per_case.setdefault(r.case_id, set()).add(r.risk_level)
    assert all(len(v) == 1 for v in per_case.values()), per_case


def test_hosted_cost_projection_is_labelled_and_never_a_measurement():
    report = asyncio.run(run_bench(["mock"], repeats=1, case_limit=1))
    # Mock records zero tokens, so there is no basis to project from — and the
    # bench says nothing rather than inventing one.
    assert report.hosted_cost_projection() is None
