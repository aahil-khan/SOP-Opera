"""
LLM-as-detector baseline (W10b) — sampling, parsing and scoring, without an LLM.

The model call itself is exercised by running the module against Ollama; what is
tested here is everything that decides whether the resulting number is honest:
the subsample is reproducible and representative, an unreadable answer is not
silently counted as a catch, and the eval-only boundary holds.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from app.eval.dataset import build_dataset
from app.eval.llm_detector import (
    LlmCaseResult,
    LlmDetectorRun,
    describe_case,
    disagreement_rate,
    parse_verdict,
    stratified_subsample,
)


def test_parse_verdict_reads_the_first_line():
    assert parse_verdict("STOP\nGas is above the action level.") is True
    assert parse_verdict("PROCEED\nNothing unusual.") is False
    assert parse_verdict("proceed") is False


def test_parse_verdict_falls_back_to_the_body_then_gives_up():
    assert parse_verdict("Well — I would stop this job.") is True
    assert parse_verdict("It depends on several factors.") is None
    assert parse_verdict(None) is None
    assert parse_verdict("") is None


def test_unreadable_answers_are_scored_as_no_alarm_not_as_a_catch():
    """Silence from a safety detector is not a catch. Flattering it would lie."""
    run = LlmDetectorRun(
        provider="ollama",
        model="llama3.2",
        results=[
            LlmCaseResult("a", dangerous=True, alarm=None, latency_ms=1.0),
            LlmCaseResult("b", dangerous=True, alarm=True, latency_ms=1.0),
            LlmCaseResult("c", dangerous=False, alarm=True, latency_ms=1.0),
            LlmCaseResult("d", dangerous=False, alarm=False, latency_ms=1.0),
        ],
    )
    m = run.metrics("llm")
    assert (m.tp, m.fn, m.fp, m.tn) == (1, 1, 1, 1)
    assert run.unparseable == 1
    assert m.recall == 0.5


def test_subsample_is_reproducible_and_sized():
    cases = build_dataset()
    a = stratified_subsample(cases, 150)
    b = stratified_subsample(cases, 150)
    assert [c.case_id for c in a] == [c.case_id for c in b]
    assert len(a) <= 150
    assert len(a) >= 140, "stratified rounding should not lose a tenth of the sample"


def test_subsample_keeps_the_positive_rate_close_to_the_full_set():
    """
    If the sample drifts, the LLM's recall is not comparable with the detectors'.
    """
    cases = build_dataset()
    sample = stratified_subsample(cases, 150)
    full_rate = sum(1 for c in cases if c.dangerous) / len(cases)
    sample_rate = sum(1 for c in sample if c.dangerous) / len(sample)
    assert abs(full_rate - sample_rate) < 0.05


def test_subsample_covers_scenarios_and_sweep_alike():
    sample = stratified_subsample(build_dataset(), 150)
    families = {
        "sweep" if c.case_id.startswith("sweep_") else ("scenario" if c.scenario else "named")
        for c in sample
    }
    assert {"sweep", "scenario"} <= families


def test_case_description_hands_over_state_not_our_answer():
    """
    The model must not be given derived-fact names or risk levels — that would
    be scoring our engine's output, not the model's judgement.
    """
    case = next(c for c in build_dataset() if c.dangerous)
    text = describe_case(case).lower()
    for leak in ("elevated_gas", "blocking", "risk_level", "derived fact", "stop-work"):
        assert leak not in text


def test_disagreement_rate_counts_changed_answers():
    runs = [
        LlmDetectorRun("ollama", "m", [LlmCaseResult("a", True, True, 1.0)]),
        LlmDetectorRun("ollama", "m", [LlmCaseResult("a", True, False, 1.0)]),
    ]
    assert disagreement_rate(runs) == 1.0
    assert disagreement_rate(runs[:1]) is None


def test_llm_detector_is_never_imported_by_shipped_code():
    """
    It exists to lose honestly in the eval. If the pipeline ever imported it, the
    LLM would be back inside the verdict path.
    """
    root = Path(inspect.getfile(build_dataset)).resolve().parents[1]
    offenders = []
    for path in root.rglob("*.py"):
        if "eval" in path.parts or "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            mod = (
                node.module
                if isinstance(node, ast.ImportFrom)
                else None
            )
            names = (
                [a.name for a in node.names] if isinstance(node, ast.Import) else []
            )
            if (mod and "llm_detector" in mod) or any(
                "llm_detector" in n for n in names
            ):
                offenders.append(str(path))
    assert not offenders, f"llm_detector imported outside eval: {offenders}"
