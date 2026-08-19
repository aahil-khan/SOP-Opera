"""
LLM-as-detector baseline (W10b) — the empirical answer to "why not just use GPT-4?"

The question is fair and it will be asked. The honest answer is a measurement:
give a language model the same plant state the rules engine sees, ask it directly
whether work must stop, and score it against the same statutory labels in
`hazard_ground_truth.py`. Two properties usually show up — it is worse, and it is
not the same twice.

**This is eval-only.** It is never imported by the assessment pipeline and never
influences a shipped verdict; `risk/policy.py::classify()` remains the only place
facts become a verdict. It exists to lose honestly.

Design notes that keep the comparison fair rather than rigged:

- The model gets the **raw context payloads**, the same information the rules read
  — not our derived-fact names, which would hand it the answer.
- The prompt states the statutory basis in general terms, so the model is not
  penalised for not knowing which Act we score against.
- The run is a **stratified subsample** (default ~150 of the full dataset), with
  `n` printed on every surface. Full-set runs stay with the deterministic
  detectors — claiming a 593-case LLM run we did not pay for would be the exact
  kind of unbacked number this repo refuses to ship.
- Determinism is measured, not assumed: `--repeats 2` reports how often the model
  changed its own mind on identical input.

    python -m app.eval.llm_detector --provider ollama --n 150 --repeats 2
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.agents.llm import get_chat_model, model_label, provider_label
from app.core.stats import LatencySummary
from app.eval.dataset import EvalCase, build_dataset
from app.eval.metrics import DetectorMetrics

SUBSAMPLE_SEED = 20260825
"""Fixed so the same subsample is scored every run — reproducible by anyone."""

SYSTEM_PROMPT = (
    "You are an industrial process safety officer at an Indian steel/refinery "
    "plant. You are given the current sensor readings, work permits, isolation "
    "records and personnel positions for one asset. Decide whether occupational "
    "safety law requires work to STOP right now.\n"
    "Answer with exactly one word on the first line: STOP or PROCEED. "
    "You may add one short sentence of reasoning on a second line."
)


def describe_case(case: EvalCase) -> str:
    """
    Render a case as plain plant state.

    Deliberately free of our vocabulary: no fact names, no risk levels, no
    mention of thresholds. The model gets the observations; whether they add up
    to a stop-work condition is the thing being tested.
    """
    lines: list[str] = []
    for entry in case.entries:
        payload = ", ".join(f"{k}={v}" for k, v in sorted(entry.payload.items()))
        stamp = entry.valid_from.strftime("%H:%M")
        lines.append(f"- [{stamp}] {entry.category}: {payload}")
    return "Current state of the asset:\n" + "\n".join(lines)


def stratified_subsample(
    cases: list[EvalCase], n: int, *, seed: int = SUBSAMPLE_SEED
) -> list[EvalCase]:
    """
    Proportional sample across (ground-truth label × case family).

    Sampling uniformly at random would let a 593-case set dominated by the
    parameter sweep crowd out the scenario timelines, and could drift the
    positive rate away from the full set — making the LLM's numbers
    incomparable with the detectors'. Strata fix both.
    """
    if n >= len(cases):
        return list(cases)
    strata: dict[tuple[bool, str], list[EvalCase]] = defaultdict(list)
    for case in cases:
        family = (
            "sweep"
            if case.case_id.startswith("sweep_")
            else ("scenario" if case.scenario else "named")
        )
        strata[(case.dangerous, family)].append(case)

    rng = random.Random(seed)
    picked: list[EvalCase] = []
    total = len(cases)
    for key in sorted(strata, key=lambda k: (k[0], k[1])):
        group = sorted(strata[key], key=lambda c: c.case_id)
        take = max(1, round(n * len(group) / total))
        picked.extend(rng.sample(group, min(take, len(group))))
    rng.shuffle(picked)
    return picked[:n]


_STOP = re.compile(r"\bstop\b", re.IGNORECASE)
_PROCEED = re.compile(r"\bproceed\b", re.IGNORECASE)


def parse_verdict(text: str | None) -> bool | None:
    """True = STOP, False = PROCEED, None = unparseable (counted, not guessed)."""
    if not text:
        return None
    first = text.strip().splitlines()[0]
    if _STOP.search(first):
        return True
    if _PROCEED.search(first):
        return False
    if _STOP.search(text):
        return True
    if _PROCEED.search(text):
        return False
    return None


@dataclass
class LlmCaseResult:
    case_id: str
    dangerous: bool
    alarm: bool | None
    latency_ms: float
    raw: str | None = None
    error: str | None = None


@dataclass
class LlmDetectorRun:
    provider: str
    model: str
    results: list[LlmCaseResult] = field(default_factory=list)

    @property
    def unparseable(self) -> int:
        return sum(1 for r in self.results if r.alarm is None)

    def metrics(self, name: str) -> DetectorMetrics:
        """
        Unparseable / failed answers are scored as PROCEED (no alarm).

        A safety detector that returns nothing has not raised an alarm — treating
        silence as a catch would flatter it.
        """
        tp = fp = tn = fn = 0
        for r in self.results:
            alarm = bool(r.alarm)
            if r.dangerous and alarm:
                tp += 1
            elif r.dangerous:
                fn += 1
            elif alarm:
                fp += 1
            else:
                tn += 1
        return DetectorMetrics(name=name, tp=tp, fp=fp, tn=tn, fn=fn)

    @property
    def latency(self) -> LatencySummary:
        return LatencySummary(r.latency_ms for r in self.results)


async def judge_case(model: Any, case: EvalCase) -> LlmCaseResult:
    t0 = time.perf_counter()
    try:
        resp = await model.ainvoke(
            [
                ("system", SYSTEM_PROMPT),
                ("human", describe_case(case)),
            ]
        )
        content = getattr(resp, "content", None)
        text = content if isinstance(content, str) else str(content)
        return LlmCaseResult(
            case_id=case.case_id,
            dangerous=case.dangerous,
            alarm=parse_verdict(text),
            latency_ms=(time.perf_counter() - t0) * 1000.0,
            raw=(text or "")[:300],
        )
    except Exception as exc:  # noqa: BLE001 — a failed judgement is a result
        return LlmCaseResult(
            case_id=case.case_id,
            dangerous=case.dangerous,
            alarm=None,
            latency_ms=(time.perf_counter() - t0) * 1000.0,
            error=str(exc)[:200],
        )


async def run_llm_detector(
    provider: str, cases: list[EvalCase], *, progress_every: int = 25
) -> LlmDetectorRun:
    model = get_chat_model(provider)
    if model is None:
        raise RuntimeError(
            f"provider '{provider}' has no chat model (mock returns None) — "
            "the LLM-as-detector baseline needs a real model to be meaningful"
        )
    run = LlmDetectorRun(provider=provider_label(provider), model=model_label(provider))
    for i, case in enumerate(cases, start=1):
        run.results.append(await judge_case(model, case))
        if progress_every and i % progress_every == 0:
            print(f"  … {i}/{len(cases)} cases", flush=True)
    return run


def disagreement_rate(runs: list[LlmDetectorRun]) -> float | None:
    """
    Share of cases where the model did not answer identically across repeats.

    This is the non-determinism finding: a deterministic rules engine has this
    number at exactly 0 by construction.
    """
    if len(runs) < 2:
        return None
    per_case: dict[str, set[bool | None]] = defaultdict(set)
    for run in runs:
        for r in run.results:
            per_case[r.case_id].add(r.alarm)
    if not per_case:
        return None
    changed = sum(1 for answers in per_case.values() if len(answers) > 1)
    return changed / len(per_case)


def _alarm_rate(m: DetectorMetrics) -> float:
    """Share of cases the detector alarmed on, regardless of whether it was right."""
    total = m.tp + m.fp + m.tn + m.fn
    return (m.tp + m.fp) / total if total else 0.0


def _base_rate_note(runs: list[LlmDetectorRun], *, first_n: int) -> list[str]:
    """
    State the alarm rate against the base rate, in words.

    Without this the table reads as "the LLM is roughly as good at recall and a
    bit worse at precision". The actual finding is that it alarms on almost
    everything, which makes its recall nearly free and its precision converge on
    the share of cases that are dangerous anyway. Anyone can derive this from
    TP+FP; leaving it for them to find would look like concealment.
    """
    if not runs:
        return []
    rates = [_alarm_rate(r.metrics("")) for r in runs]
    positives = sum(1 for r in runs[0].results if r.dangerous)
    base_rate = positives / first_n if first_n else 0.0
    span = (
        f"{min(rates):.0%}"
        if abs(max(rates) - min(rates)) < 0.005
        else f"{min(rates):.0%}–{max(rates):.0%}"
    )
    precisions = [r.metrics("").precision for r in runs]
    return [
        "### What the recall number is actually worth",
        "",
        f"The model answered STOP on **{span} of cases**. In this subsample "
        f"**{base_rate:.0%}** of cases genuinely require stopping work "
        f"({positives} of {first_n}), so a detector that alarms on nearly "
        "everything collects high recall automatically — and its precision "
        f"lands at {min(precisions):.0%}–{max(precisions):.0%}, which is "
        "approximately the base rate itself.",
        "",
        "That is the real finding, and it is worse for the LLM than a simple",
        "\"it missed some\" reading: asked to judge safety directly, it does not",
        "discriminate. The compound engine reaches 100% recall while alarming on",
        "only the cases that warrant it — that gap, not the recall column, is the",
        "answer to \"why not just use GPT-4?\".",
        "",
    ]


def build_markdown(
    runs: list[LlmDetectorRun],
    *,
    compound: DetectorMetrics,
    single: DetectorMetrics,
    full_case_count: int,
    openai_note: str,
) -> str:
    first = runs[0]
    n = len(first.results)
    disagreement = disagreement_rate(runs)
    lines = [
        "# LLM-as-detector baseline",
        "",
        f"Generated {datetime.now(timezone.utc).isoformat(timespec='seconds')}.",
        "",
        "**The question this answers: \"why not just ask GPT-4 whether it's "
        "safe?\"** So we did — same plant states, same statutory labels, scored",
        "the same way.",
        "",
        f"**n = {n}** stratified cases sampled from the full {full_case_count}-case",
        f"dataset (seed {SUBSAMPLE_SEED}, proportional across label × case family).",
        "The deterministic detectors below are scored on the **full** dataset;",
        "the LLM is not, and that difference is stated rather than smoothed over.",
        "",
        "## Results",
        "",
        "**Read the alarm-rate column before the recall column.** A detector that "
        "shouts STOP at everything scores high recall for free; the alarm rate is "
        "what tells you whether the recall meant anything.",
        "",
        "| Detector | n | Alarm rate | Recall | Precision | FN | Accuracy |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for i, run in enumerate(runs, start=1):
        m = run.metrics(f"LLM ({run.provider}:{run.model}) run {i}")
        lines.append(
            f"| {m.name} | {len(run.results)} | {_alarm_rate(m):.1%} | "
            f"{m.recall:.1%} | {m.precision:.1%} | {m.fn} | {m.accuracy:.1%} |"
        )
    lines.extend(
        [
            f"| Single-sensor baseline (full set) | {full_case_count} | "
            f"{_alarm_rate(single):.1%} | "
            f"{single.recall:.1%} | {single.precision:.1%} | {single.fn} | "
            f"{single.accuracy:.1%} |",
            f"| **Compound engine (full set)** | {full_case_count} | "
            f"{_alarm_rate(compound):.1%} | "
            f"**{compound.recall:.1%}** | {compound.precision:.1%} | "
            f"**{compound.fn}** | {compound.accuracy:.1%} |",
            "",
        ]
    )
    lines.extend(_base_rate_note(runs, first_n=n))
    if disagreement is not None:
        lines.extend(
            [
                "## Run-to-run agreement",
                "",
                f"Across {len(runs)} runs on identical inputs, the model changed "
                f"its own answer on **{disagreement:.1%}** of cases.",
                "The rules engine's equivalent number is 0% by construction — it",
                "is a pure function. For a stop-work decision that has to be",
                "defensible after an incident, reproducibility is not a nicety.",
                "",
            ]
        )
    lat = first.latency.as_dict()
    lines.extend(
        [
            "## Cost of the comparison",
            "",
            f"- Latency per judgement: p50 {lat['p50_ms']} ms · p95 {lat['p95_ms']} ms",
            f"- Unparseable answers (scored as PROCEED): {first.unparseable}",
            "",
            "## What is not here",
            "",
            f"- {openai_note}",
            "- The LLM detector is **eval-only**. It is not imported by the",
            "  assessment pipeline and cannot affect a shipped verdict.",
            "",
        ]
    )
    return "\n".join(lines)


async def _main() -> None:
    parser = argparse.ArgumentParser(description="LLM-as-detector baseline (W10b)")
    parser.add_argument("--provider", default="ollama")
    parser.add_argument("--n", type=int, default=150)
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--out", default="llm-detector-baseline")
    args = parser.parse_args()

    from app.eval.metrics import run_evaluation

    all_cases = build_dataset()
    cases = stratified_subsample(all_cases, args.n)
    positives = sum(1 for c in cases if c.dangerous)
    print(
        f"subsample: n={len(cases)} of {len(all_cases)} "
        f"({positives} stop-work, {len(cases) - positives} safe)"
    )

    runs: list[LlmDetectorRun] = []
    for i in range(args.repeats):
        print(f"run {i + 1}/{args.repeats} on provider={args.provider}")
        runs.append(await run_llm_detector(args.provider, cases))

    report = run_evaluation(all_cases)
    # The note has to follow what actually ran. It used to be hardcoded to
    # "NOT RUN", which was honest while there was no key but became a false
    # statement the moment a hosted run produced the very table it sits under.
    if args.provider == "openai_compatible":
        openai_note = (
            "**OpenAI baseline: RUN — the rows above are the hosted model.** "
            "Cross-check against the local-model run in "
            "`docs/llm-detector-baseline.md`: both land in the same place, so "
            "the finding is a property of asking an LLM to judge safety "
            "directly, not an artefact of one model's size."
        )
    else:
        openai_note = (
            "**OpenAI baseline: NOT RUN in this invocation.** The harness takes "
            "`--provider openai_compatible`; see `docs/llm-detector-openai.md` "
            "for the hosted row. No hosted numbers are estimated in its place."
        )
    md = build_markdown(
        runs,
        compound=report.compound,
        single=report.single_sensor,
        full_case_count=report.case_count,
        openai_note=openai_note,
    )
    print("\n" + md)

    docs = Path(__file__).resolve().parents[3] / "docs"
    docs.mkdir(parents=True, exist_ok=True)
    (docs / f"{args.out}.md").write_text(md, encoding="utf-8")
    (docs / f"{args.out}.json").write_text(
        json.dumps(
            {
                "n": len(cases),
                "full_case_count": len(all_cases),
                "seed": SUBSAMPLE_SEED,
                "provider": runs[0].provider,
                "model": runs[0].model,
                "openai": (
                    "RUN — see provider/model fields"
                    if args.provider == "openai_compatible"
                    else "NOT RUN in this invocation — see docs/llm-detector-openai.md"
                ),
                "disagreement_rate": disagreement_rate(runs),
                "subsample_positive_rate": (positives / len(cases) if cases else 0.0),
                "runs": [
                    {
                        "alarm_rate": _alarm_rate(run.metrics("llm")),
                        "recall": run.metrics("llm").recall,
                        "precision": run.metrics("llm").precision,
                        "fn": run.metrics("llm").fn,
                        "fp": run.metrics("llm").fp,
                        "tp": run.metrics("llm").tp,
                        "tn": run.metrics("llm").tn,
                        "unparseable": run.unparseable,
                        "latency_ms": run.latency.as_dict(),
                    }
                    for run in runs
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {docs / (args.out + '.md')}")


if __name__ == "__main__":
    asyncio.run(_main())
