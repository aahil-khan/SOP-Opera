"""
Model bench — what actually varies when you swap the LLM (W9b).

Deliberately **not** an accuracy benchmark. `risk/policy.py::classify()` owns the
verdict and the LLM only writes prose, so "which model is more accurate" is not a
real axis and presenting one would be an invented metric. What the model *does*
change is how it narrates, how often it invents a citation, how long it takes and
what it costs. Those are the four things measured here, plus the reliability of
the call itself:

| Metric | Where it comes from |
| --- | --- |
| Citation-strip rate | `assessment/citations.py` — our own shipped guard |
| Latency p50 / p95   | wall clock per run, summarized by `core/stats.py` |
| Cost per assessment | `agents/llm.py::estimate_cost_usd()` over real token usage |
| Failure / retry rate | attempts vs successes under `assessment_max_retries` |

The headline result is the **invariance table**: the same inputs through every
provider produce the same `risk_level` every time. That is the answer to "how can
I trust one agent" and to "why not just use GPT-4" — the model is swappable
because it was never the thing deciding.

Runs the agent graph directly with fixed retrieved references, so no database is
required and the only variable between providers is the model.

    python -m app.eval.model_bench                       # mock only (fast)
    python -m app.eval.model_bench --providers mock,ollama
    python -m app.eval.model_bench --providers mock,ollama,openai_compatible
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from app.agents.graph import run_agent_assessment
from app.assessment.citations import (
    aggregate_strip_stats,
    stripped_citations_in_trace,
)
from app.core.config import get_settings
from app.core.stats import LatencySummary
from app.eval.dataset import EvalCase, scenario_timeline_cases, static_cases
from shared.python.schemas import DerivedFact, RetrievedReference

BENCH_ASSET = UUID("11111111-1111-1111-1111-111111111111")

# A small fixed reference set stands in for retrieval. Retrieval is
# provider-independent (orchestrator-driven SQL/pgvector, not model-driven), so
# holding it constant isolates the model as the only variable — and gives the
# citation guard a fixed corpus to judge invented clauses against.
BENCH_REFERENCES: list[RetrievedReference] = [
    RetrievedReference(
        source="regulations",
        id=UUID("22222222-2222-2222-2222-222222222221"),
        retrieval_path="deterministic",
        title="OISD-STD-105 — Work Permit System",
        code="OISD-STD-105",
        snippet=(
            "Hot work shall not be permitted until the atmosphere is tested and "
            "found free of flammable gas, and equipment is positively isolated."
        ),
        source_url="https://www.oisd.gov.in/",
        triggered_by_fact="incomplete_isolation",
    ),
    RetrievedReference(
        source="regulations",
        id=UUID("22222222-2222-2222-2222-222222222222"),
        retrieval_path="deterministic",
        title="Factories Act 1948 s.37(1) — Explosive or inflammable gas",
        code="Factories Act 1948 s.37",
        snippet=(
            "Where any manufacturing process produces inflammable gas, all "
            "practicable measures shall be taken to prevent an explosion."
        ),
        source_url="https://www.indiacode.nic.in/",
        triggered_by_fact="elevated_gas",
    ),
    RetrievedReference(
        source="historical_incidents",
        id=UUID("22222222-2222-2222-2222-222222222223"),
        retrieval_path="deterministic",
        title="Coke-oven gas release during unisolated hot work",
        snippet=(
            "Gas accumulated below the single-sensor alarm line while a hot-work "
            "permit was open on unisolated equipment."
        ),
        triggered_by_fact="elevated_gas",
    ),
]


def bench_cases(limit: int = 6) -> list[EvalCase]:
    """
    Fixed, representative workload: named narrative cases plus the hero timeline.

    Small on purpose — this is a per-provider LLM benchmark, and a local model at
    a few seconds per run makes a large set expensive without making the latency
    percentiles better.
    """
    cases = list(static_cases())
    cases.extend(
        c for c in scenario_timeline_cases("vsp_coke_oven") if c.step_index in (1, 2, 3)
    )
    return cases[:limit]


def _facts_and_entries(case: EvalCase) -> tuple[list[DerivedFact], list[dict[str, Any]]]:
    """Turn an eval case into the shapes `run_agent_assessment` expects."""
    from app.context.derived_facts import evaluate_rules

    now = datetime.now(timezone.utc)
    evaluations = evaluate_rules(list(case.entries))
    facts = [
        DerivedFact(
            id=uuid4(),
            asset_id=BENCH_ASSET,
            fact_type=name,
            value=fact.value,
            computed_at=now,
            source_context_ids=[],
        )
        for name, fact in evaluations.items()
        if fact is not None
    ]
    entries = [
        {
            "id": str(e.id),
            "asset_id": str(e.asset_id),
            "category": e.category,
            "payload": dict(e.payload),
            "provider": e.provider,
            "valid_from": e.valid_from,
            "valid_until": e.valid_until,
            "confidence": e.confidence,
        }
        for e in case.entries
    ]
    return facts, entries


@dataclass
class RunResult:
    case_id: str
    provider: str
    ok: bool
    attempts: int
    latency_ms: float
    risk_level: str | None = None
    summary: str | None = None
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    stripped_citations: list[str] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None


@dataclass
class ProviderResult:
    provider: str
    status: str
    """`measured` when runs actually executed, `not_run` when the leg was skipped."""
    model: str | None = None
    note: str | None = None
    runs: list[RunResult] = field(default_factory=list)

    @property
    def successes(self) -> list[RunResult]:
        return [r for r in self.runs if r.ok]

    @property
    def latency(self) -> LatencySummary:
        return LatencySummary(r.latency_ms for r in self.successes)

    @property
    def failure_rate(self) -> float:
        return 1.0 - (len(self.successes) / len(self.runs)) if self.runs else 0.0

    @property
    def retry_rate(self) -> float:
        """Share of runs that needed more than one attempt to produce a verdict."""
        if not self.runs:
            return 0.0
        return sum(1 for r in self.runs if r.attempts > 1) / len(self.runs)

    @property
    def strip_stats(self):
        return aggregate_strip_stats(
            (r.trace for r in self.successes),
            summaries=[r.summary for r in self.successes],
        )

    @property
    def mean_cost_usd(self) -> float:
        ok = self.successes
        return sum(r.cost_usd for r in ok) / len(ok) if ok else 0.0

    @property
    def mean_tokens(self) -> tuple[float, float]:
        ok = self.successes
        if not ok:
            return 0.0, 0.0
        return (
            sum(r.tokens_in for r in ok) / len(ok),
            sum(r.tokens_out for r in ok) / len(ok),
        )


async def run_case(
    case: EvalCase, provider: str, *, max_retries: int
) -> RunResult:
    """One assessment through the real agent graph, with the shipped retry budget."""
    facts, entries = _facts_and_entries(case)
    review_id, assessment_id = uuid4(), uuid4()
    last_error: Exception | None = None
    t0 = time.perf_counter()
    for attempt in range(max_retries + 1):
        try:
            generation, trace, _links, _stats = await run_agent_assessment(
                review_id=review_id,
                assessment_id=assessment_id,
                asset_id=BENCH_ASSET,
                asset_name="Coke Oven Battery 3",
                asset_zone="coke-oven-battery",
                facts=facts,
                context_entries=entries,
                retrieved_references=BENCH_REFERENCES,
                provider_name=provider,
            )
            return RunResult(
                case_id=case.case_id,
                provider=provider,
                ok=True,
                attempts=attempt + 1,
                latency_ms=(time.perf_counter() - t0) * 1000.0,
                risk_level=generation.result.risk_level,
                summary=generation.result.summary,
                model=generation.model,
                tokens_in=generation.input_tokens,
                tokens_out=generation.output_tokens,
                cost_usd=generation.estimated_cost_usd,
                stripped_citations=stripped_citations_in_trace(trace),
                trace=list(trace),
            )
        except Exception as exc:  # noqa: BLE001 — a failed run is a measurement
            last_error = exc
    return RunResult(
        case_id=case.case_id,
        provider=provider,
        ok=False,
        attempts=max_retries + 1,
        latency_ms=(time.perf_counter() - t0) * 1000.0,
        error=str(last_error)[:200],
    )


def provider_available(provider: str) -> tuple[bool, str | None]:
    """
    Can this leg honestly run right now?

    A leg that cannot run is reported as NOT RUN with the reason. It is never
    estimated, and never filled in from a previous run of a different provider.
    """
    from app.assessment.provider_state import check_provider

    check = check_provider(provider)
    if check.ok:
        return True, None
    return False, check.reason


async def bench_provider(
    provider: str, cases: list[EvalCase], *, repeats: int, max_retries: int
) -> ProviderResult:
    from app.agents.llm import model_label

    ok, reason = provider_available(provider)
    if not ok:
        return ProviderResult(
            provider=provider, status="not_run", note=reason, model=None
        )
    runs: list[RunResult] = []
    for _ in range(repeats):
        for case in cases:
            runs.append(await run_case(case, provider, max_retries=max_retries))
    return ProviderResult(
        provider=provider,
        status="measured",
        model=model_label(provider),
        runs=runs,
    )


@dataclass
class BenchReport:
    providers: list[ProviderResult]
    cases: list[str]
    repeats: int
    generated_at: str

    # --- W9c cost projection inputs. Assumptions, stated as assumptions. ---
    assessments_per_day: int = 400
    """Plant-scale assumption: ~400 assessments/day (one mid-size plant, all shifts)."""
    incident_cost_usd: float = 1_000_000.0
    """Order-of-magnitude placeholder for one lost-time process incident."""

    def invariance(self) -> tuple[dict[str, dict[str, str | None]], bool]:
        """Per case, the verdict each measured provider produced."""
        table: dict[str, dict[str, str | None]] = {}
        consistent = True
        for case_id in self.cases:
            row: dict[str, str | None] = {}
            for p in self.providers:
                if p.status != "measured":
                    continue
                verdicts = {
                    r.risk_level for r in p.successes if r.case_id == case_id
                }
                row[p.provider] = (
                    "/".join(sorted(v for v in verdicts if v)) if verdicts else None
                )
            observed = {v for v in row.values() if v}
            if len(observed) > 1:
                consistent = False
            table[case_id] = row
        return table, consistent

    def to_json(self) -> dict[str, Any]:
        table, consistent = self.invariance()
        out: dict[str, Any] = {
            "generated_at": self.generated_at,
            "cases": self.cases,
            "repeats": self.repeats,
            "verdict_invariant_across_measured_providers": consistent,
            "invariance": table,
            "providers": [],
        }
        for p in self.providers:
            if p.status != "measured":
                out["providers"].append(
                    {
                        "provider": p.provider,
                        "status": "NOT RUN",
                        "reason": p.note,
                    }
                )
                continue
            lat = p.latency.as_dict()
            stats = p.strip_stats
            tin, tout = p.mean_tokens
            out["providers"].append(
                {
                    "provider": p.provider,
                    "status": "measured",
                    "model": p.model,
                    "runs": len(p.runs),
                    "successes": len(p.successes),
                    "failure_rate": round(p.failure_rate, 4),
                    "retry_rate": round(p.retry_rate, 4),
                    "latency_ms": lat,
                    "citation_strip_rate": round(stats.strip_rate, 4),
                    "citation_token_strip_rate": round(stats.token_strip_rate, 4),
                    "citations_cited": stats.cited_tokens,
                    "citations_stripped": stats.stripped_tokens,
                    "mean_tokens_in": round(tin, 1),
                    "mean_tokens_out": round(tout, 1),
                    "mean_cost_usd_per_assessment": round(p.mean_cost_usd, 8),
                    "projected_cost_usd_per_day": round(
                        p.mean_cost_usd * self.assessments_per_day, 4
                    ),
                    "projected_cost_usd_per_year": round(
                        p.mean_cost_usd * self.assessments_per_day * 365, 2
                    ),
                }
            )
        out["hosted_cost_projection"] = self.hosted_cost_projection()
        return out

    def hosted_cost_projection(self) -> dict[str, Any] | None:
        """
        What a hosted model *would* cost per assessment, at our measured prompt size.

        This is arithmetic, not a measurement, and the distinction is load-bearing:
        the token counts are real (captured from a provider that actually ran), the
        per-token prices are published list prices, and **no OpenAI request was
        made**. Reported so the unit-economics question has an answer while the key
        is missing — never presented as an OpenAI benchmark result.
        """
        from app.agents.llm import _PRICE_PER_1M, estimate_cost_usd

        source = next(
            (
                p
                for p in self.providers
                if p.status == "measured" and p.mean_tokens[0] > 0
            ),
            None,
        )
        if source is None:
            return None
        tin, tout = source.mean_tokens
        rows = []
        for model in ("gpt-4o-mini", "gpt-4o"):
            per_assessment = estimate_cost_usd(
                "openai_compatible", model, int(round(tin)), int(round(tout))
            )
            rows.append(
                {
                    "model": model,
                    "price_per_1m_in_out": _PRICE_PER_1M[model],
                    "usd_per_assessment": round(per_assessment, 8),
                    "usd_per_day": round(per_assessment * self.assessments_per_day, 4),
                    "usd_per_year": round(
                        per_assessment * self.assessments_per_day * 365, 2
                    ),
                }
            )
        return {
            "basis": "PROJECTED — no OpenAI request was made",
            "token_counts_measured_on": f"{source.provider}:{source.model}",
            "mean_tokens_in": round(tin, 1),
            "mean_tokens_out": round(tout, 1),
            "assessments_per_day_assumption": self.assessments_per_day,
            "rows": rows,
        }

    def to_markdown(self) -> str:
        data = self.to_json()
        measured = [p for p in self.providers if p.status == "measured"]
        not_run = [p for p in self.providers if p.status != "measured"]
        lines = [
            "# Model bench — what changes when you swap the model",
            "",
            f"Generated {self.generated_at} · {len(self.cases)} case(s) × "
            f"{self.repeats} repeat(s) per provider.",
            "",
            "This bench deliberately does **not** measure accuracy against model.",
            "`app/risk/policy.py::classify()` owns `risk_level`; the model writes",
            "prose only. What varies with the model is narration, invented",
            "citations, latency and cost — those are what is measured.",
            "",
            "## Measured",
            "",
            "| Provider | Model | Runs | Citation-strip rate | Agent latency p50 | "
            "Agent latency p95 | Cost / assessment | Failure rate | Retry rate |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for p in measured:
            lat = p.latency.as_dict()
            stats = p.strip_stats

            def _ms(v: Any) -> str:
                return f"{v:,.0f} ms" if isinstance(v, (int, float)) else "—"

            lines.append(
                f"| {p.provider} | `{p.model}` | {len(p.runs)} | "
                f"{stats.strip_rate:.1%} ({stats.stripped_tokens}/"
                f"{stats.cited_tokens} tokens) | {_ms(lat['p50_ms'])} | "
                f"{_ms(lat['p95_ms'])} | ${p.mean_cost_usd:.6f} | "
                f"{p.failure_rate:.1%} | {p.retry_rate:.1%} |"
            )
        if not measured:
            lines.append("| _none_ | | | | | | | | |")
        lines.extend(
            [
                "",
                "**Read the columns for exactly what they measure.**",
                "",
                "- *Citation-strip rate* is stripped ÷ cited tokens, and the "
                "denominator is printed because it is small: a 0% over few or no "
                "cited tokens means the models rarely cited at all on this case "
                "set, not that hallucination was ruled out.",
                "- *Agent latency* is wall-clock around the LangGraph run only. It "
                "**excludes** retrieval, DB persistence and time queued — so it is "
                "not end-to-end assessment latency and should not be quoted as "
                "\"time to a verdict on screen\".",
                (
                    "- *Cost* is priced by `estimate_cost_usd()`, which covers "
                    "OpenAI-compatible models only (`agents/llm.py:149-154`). A $0 "
                    "row for `mock` or `ollama` means unpriced, not free — for "
                    "`ollama` the real cost is the machine it runs on."
                    if any(p.mean_cost_usd for p in measured)
                    else "- *Cost* is $0 for every provider here **by "
                    "construction**: `estimate_cost_usd()` prices "
                    "OpenAI-compatible models only (`agents/llm.py:149-154`). It "
                    "is not evidence that inference is free."
                ),
                "",
                "`mock` makes no network call at all — its narration is a",
                "deterministic template (`agents/llm.py` returns `None`), so its",
                "latency is the graph itself and its cost is zero by construction,",
                "not by measurement. Ollama runs locally: **no API cost**, the cost",
                "is the machine it runs on.",
                "",
            ]
        )
        if not_run:
            lines.extend(["## Not run", ""])
            for p in not_run:
                lines.append(f"- **{p.provider}: NOT RUN** — {p.note}")
            lines.extend(
                [
                    "",
                    "No numbers are estimated for a provider that did not run. The",
                    "harness is wired for it; adding the key and re-running this",
                    "command fills the row in.",
                    "",
                ]
            )
        table, consistent = self.invariance()
        lines.extend(
            [
                "## Verdict invariance — the point of the bench",
                "",
                "Same inputs, different model, same verdict. The narration changes;",
                "`risk_level` does not, because the model never writes it.",
                "",
                "| Case | " + " | ".join(p.provider for p in measured) + " |",
                "| --- |" + " --- |" * len(measured),
            ]
        )
        for case_id, row in table.items():
            cells = " | ".join(str(row.get(p.provider) or "—") for p in measured)
            lines.append(f"| `{case_id}` | {cells} |")
        lines.extend(
            [
                "",
                f"**Verdict identical across every measured provider: "
                f"{'yes' if consistent else 'NO — investigate'}**",
                "",
                "## Cost projection (W9c) — PROJECTED, not measured",
                "",
                "Measured per-assessment cost above, extrapolated on a stated",
                f"assumption of **{self.assessments_per_day} assessments/day** at",
                "plant scale. Everything in this section is arithmetic on the",
                "measured number, labelled as an estimate.",
                "",
                "| Provider | Cost / assessment (MEASURED) | Per day (PROJECTED) | "
                "Per year (PROJECTED) |",
                "| --- | ---: | ---: | ---: |",
            ]
        )
        for p in measured:
            lines.append(
                f"| {p.provider} | ${p.mean_cost_usd:.6f} | "
                f"${p.mean_cost_usd * self.assessments_per_day:,.2f} | "
                f"${p.mean_cost_usd * self.assessments_per_day * 365:,.2f} |"
            )
        for p in not_run:
            lines.append(f"| {p.provider} | NOT RUN | NOT RUN | NOT RUN |")

        proj = self.hosted_cost_projection()
        if proj is not None:
            lines.extend(
                [
                    "",
                    "### If the hosted model were used — PROJECTED, no request made",
                    "",
                    "The prompt size is the same whichever model answers it, so a",
                    "hosted bill can be projected from token counts we did measure",
                    f"(**{proj['mean_tokens_in']:.0f} in / "
                    f"{proj['mean_tokens_out']:.0f} out** per assessment, measured on",
                    f"`{proj['token_counts_measured_on']}`) times published list",
                    "prices. **This is arithmetic, not a benchmark result: no OpenAI",
                    "request was made.** The measured hosted row stays empty until a",
                    "key exists.",
                    "",
                    "| Hosted model | $/1M in · out | $/assessment | $/day | $/year |",
                    "| --- | --- | ---: | ---: | ---: |",
                ]
            )
            for row in proj["rows"]:
                pin, pout = row["price_per_1m_in_out"]
                lines.append(
                    f"| {row['model']} | ${pin:.2f} · ${pout:.2f} | "
                    f"${row['usd_per_assessment']:.6f} | "
                    f"${row['usd_per_day']:,.2f} | ${row['usd_per_year']:,.2f} |"
                )
        lines.extend(
            [
                "",
                "Against a single lost-time process incident, conventionally costed",
                "in the millions, the annual model spend above is the rounding error",
                "— but note the honest form of the claim: this compares a *running",
                "cost* to a *prevented loss*, and prevention is what the eval",
                "measures, not this table.",
                "",
                "## Raw",
                "",
                "```json",
                json.dumps(data, indent=2)[:4000],
                "```",
                "",
            ]
        )
        return "\n".join(lines)


async def run_bench(
    providers: list[str], *, repeats: int = 1, case_limit: int = 6
) -> BenchReport:
    settings = get_settings()
    cases = bench_cases(case_limit)
    results = [
        await bench_provider(
            p, cases, repeats=repeats, max_retries=settings.assessment_max_retries
        )
        for p in providers
    ]
    return BenchReport(
        providers=results,
        cases=[c.case_id for c in cases],
        repeats=repeats,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )


def _docs_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "docs"


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Model bench (W9b/W9c)")
    parser.add_argument(
        "--providers",
        default="mock",
        help="comma-separated: mock,ollama,openai_compatible",
    )
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--cases", type=int, default=6)
    parser.add_argument("--out", default=None, help="output basename under docs/")
    args = parser.parse_args()

    providers = [p.strip() for p in args.providers.split(",") if p.strip()]
    report = await run_bench(providers, repeats=args.repeats, case_limit=args.cases)

    md = report.to_markdown()
    print(md)
    base = args.out or "model-bench"
    docs = _docs_dir()
    docs.mkdir(parents=True, exist_ok=True)
    (docs / f"{base}.md").write_text(md, encoding="utf-8")
    (docs / f"{base}.json").write_text(
        json.dumps(report.to_json(), indent=2), encoding="utf-8"
    )
    print(f"\nwrote {docs / (base + '.md')} and {docs / (base + '.json')}")


if __name__ == "__main__":
    asyncio.run(_main())
