"""
Seed LangSmith with LangGraph assessment runs from the eval dataset.

The main eval harness (`python -m app.eval.run`) scores deterministic detectors
and does NOT touch LangGraph. This script reuses the same labeled snapshots but
runs them through `run_agent_assessment` so traces appear in LangSmith.

Usage (from repo root, with tracing env vars set):
  cd backend && source ../.venv/bin/activate && export PYTHONPATH=/path/to/sop-opera
  python -m app.eval.run_langsmith_traces
  python -m app.eval.run_langsmith_traces --subset narrative
  python -m app.eval.run_langsmith_traces --subset sweep --limit 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from uuid import UUID, uuid4

from app.agents.graph import reset_compiled_graph, run_agent_assessment
from app.context.derived_facts import ContextEntryView, evaluate_rules
from app.core.config import get_settings
from app.eval.dataset import (
    EVAL_ASSET,
    NOW,
    SCENARIOS,
    EvalCase,
    build_dataset,
    scenario_timeline_cases,
    static_cases,
    sweep_cases,
)


def _context_dict(entry: ContextEntryView) -> dict:
    return {
        "id": str(entry.id),
        "category": entry.category,
        "payload": dict(entry.payload),
    }


def _cases_for_subset(name: str) -> list[EvalCase]:
    if name == "narrative":
        cases: list[EvalCase] = []
        cases.extend(static_cases())
        for scenario in SCENARIOS:
            cases.extend(scenario_timeline_cases(scenario))
        return cases
    if name == "sweep":
        return sweep_cases()
    if name == "all":
        return build_dataset()
    raise ValueError(f"unknown subset: {name}")


async def _run_case(case: EvalCase, provider: str | None) -> dict:
    evaluations = evaluate_rules(list(case.entries), now=NOW)
    facts = [fact for fact in evaluations.values() if fact is not None]
    context_entries = [_context_dict(entry) for entry in case.entries]

    generation, trace, _links, stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=EVAL_ASSET,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=facts,
        context_entries=context_entries,
        retrieved_references=[],
        provider_name=provider,
    )
    agents = sorted({step.get("agent") for step in trace if step.get("agent")})
    return {
        "case_id": case.case_id,
        "risk_level": generation.result.risk_level,
        "provider": generation.provider,
        "agents": agents,
        "input_tokens": generation.input_tokens,
        "output_tokens": generation.output_tokens,
        "llm_calls": stats.get("llm_call_count", 0),
    }


async def _main_async(args: argparse.Namespace) -> int:
    settings = get_settings()
    tracing_on = bool(settings.langchain_tracing_v2 and settings.langchain_api_key)
    provider = args.provider or settings.ai_provider

    cases = _cases_for_subset(args.subset)
    if args.limit is not None:
        cases = cases[: max(0, args.limit)]

    print(
        json.dumps(
            {
                "subset": args.subset,
                "case_count": len(cases),
                "provider": provider,
                "langsmith_tracing": tracing_on,
                "langchain_project": settings.langchain_project,
            },
            indent=2,
        ),
        file=sys.stderr,
    )
    if not tracing_on:
        print(
            "Warning: LANGCHAIN_TRACING_V2 and LANGCHAIN_API_KEY are not both set; "
            "runs will execute but may not appear in LangSmith.",
            file=sys.stderr,
        )

    results: list[dict] = []
    for i, case in enumerate(cases, start=1):
        reset_compiled_graph()
        result = await _run_case(case, provider)
        results.append(result)
        print(
            f"[{i}/{len(cases)}] {case.case_id} → {result['risk_level']} "
            f"({len(result['agents'])} agents)",
            file=sys.stderr,
        )

    print(json.dumps({"runs": results}, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run eval dataset cases through LangGraph for LangSmith traces."
    )
    parser.add_argument(
        "--subset",
        choices=("narrative", "sweep", "all"),
        default="narrative",
        help="narrative = static + scenario timelines (~17 cases); "
        "sweep = parameter grid (576); all = full 593-case dataset",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Run at most N cases (useful for sweep/all with real LLMs)",
    )
    parser.add_argument(
        "--provider",
        default=None,
        help="Override AI_PROVIDER for these runs (default: settings)",
    )
    return asyncio.run(_main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
