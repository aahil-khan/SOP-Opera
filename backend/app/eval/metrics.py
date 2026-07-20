"""Confusion matrix, false-negative rate, and report generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from app.eval.dataset import EvalCase, build_dataset, hero_checkpoint
from app.eval.detectors import compound_alarm, single_sensor_alarm
from app.eval.lead_time import ScenarioLeadTime, compute_scenario_lead_time, hero_lead_time


@dataclass(frozen=True)
class DetectorMetrics:
    name: str
    tp: int
    fp: int
    tn: int
    fn: int

    @property
    def accuracy(self) -> float:
        total = self.tp + self.fp + self.tn + self.fn
        return (self.tp + self.tn) / total if total else 0.0

    @property
    def recall(self) -> float:
        denom = self.tp + self.fn
        return self.tp / denom if denom else 0.0

    @property
    def false_negative_rate(self) -> float:
        denom = self.tp + self.fn
        return self.fn / denom if denom else 0.0

    @property
    def precision(self) -> float:
        denom = self.tp + self.fp
        return self.tp / denom if denom else 0.0


@dataclass
class CaseResult:
    case_id: str
    label: str
    dangerous: bool
    single_alarm: bool
    compound_alarm: bool
    compound_only_catch: bool


@dataclass
class EvalReport:
    single_sensor: DetectorMetrics
    compound: DetectorMetrics
    case_results: list[CaseResult] = field(default_factory=list)
    fn_reduction_pct: float = 0.0
    hero_case_id: str = "vsp_coke_oven_step2"
    hero_lead_time: ScenarioLeadTime | None = None

    def to_markdown(self) -> str:
        lines = [
            "# Compound vs Single-Sensor Evaluation",
            "",
            "Headline metric for the VSP coke-oven story: **false-negative rate** on",
            "ground-truth dangerous cases (blocking intervention warranted).",
            "",
            "## Summary",
            "",
            "| Detector | Accuracy | Recall | FN rate | Precision |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
        for m in (self.single_sensor, self.compound):
            lines.append(
                f"| {m.name} | {m.accuracy:.1%} | {m.recall:.1%} | "
                f"{m.false_negative_rate:.1%} | {m.precision:.1%} |"
            )
        lines.extend(
            [
                "",
                f"**FN reduction (compound vs single-sensor):** {self.fn_reduction_pct:.1f}%",
                "",
            ]
        )
        if self.hero_lead_time and self.hero_lead_time.lead_time_seconds is not None:
            lt = self.hero_lead_time
            lines.extend(
                [
                    "## Prediction lead time (hero scenario)",
                    "",
                    f"VSP coke-oven timeline: compound alarm at **{lt.t_compound_seconds:.0f}s**, "
                    f"single-sensor critical at **{lt.t_single_sensor_seconds:.0f}s** → "
                    f"**{lt.lead_time_seconds:.0f}s lead time** before incident threshold.",
                    "",
                ]
            )
        lines.extend(
            [
                "## Hero checkpoint",
                "",
                f"Case `{self.hero_case_id}` — compound blocks while gas stays below the",
                "single-sensor critical threshold.",
                "",
                "## Per-case detail",
                "",
                "| Case | Dangerous | Single | Compound | Compound-only catch |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for r in self.case_results:
            lines.append(
                f"| {r.case_id} | {r.dangerous} | {r.single_alarm} | "
                f"{r.compound_alarm} | {r.compound_only_catch} |"
            )
        return "\n".join(lines) + "\n"


def _confusion(
    cases: list[EvalCase],
    *,
    name: str,
    alarm_fn,
) -> tuple[DetectorMetrics, list[CaseResult]]:
    tp = fp = tn = fn = 0
    results: list[CaseResult] = []
    for case in cases:
        alarm = alarm_fn(list(case.entries))
        if case.dangerous and alarm:
            tp += 1
        elif case.dangerous and not alarm:
            fn += 1
        elif not case.dangerous and alarm:
            fp += 1
        else:
            tn += 1
        results.append(
            CaseResult(
                case_id=case.case_id,
                label=case.label,
                dangerous=case.dangerous,
                single_alarm=single_sensor_alarm(list(case.entries)),
                compound_alarm=compound_alarm(list(case.entries)),
                compound_only_catch=(
                    case.dangerous
                    and compound_alarm(list(case.entries))
                    and not single_sensor_alarm(list(case.entries))
                ),
            )
        )
    return DetectorMetrics(name=name, tp=tp, fp=fp, tn=tn, fn=fn), results


def run_evaluation(cases: list[EvalCase] | None = None) -> EvalReport:
    cases = cases or build_dataset()
    single, _ = _confusion(cases, name="Single-sensor baseline", alarm_fn=single_sensor_alarm)
    compound, case_results = _confusion(
        cases, name="Compound engine", alarm_fn=compound_alarm
    )

    single_fn = single.false_negative_rate
    compound_fn = compound.false_negative_rate
    if single_fn > 0:
        fn_reduction = ((single_fn - compound_fn) / single_fn) * 100.0
    else:
        fn_reduction = 100.0 if compound_fn == 0 else 0.0

    hero = hero_checkpoint()
    return EvalReport(
        single_sensor=single,
        compound=compound,
        case_results=case_results,
        fn_reduction_pct=fn_reduction,
        hero_case_id=hero.case_id,
        hero_lead_time=hero_lead_time(),
    )


def write_report(path: Path | None = None) -> EvalReport:
    report = run_evaluation()
    out = path or Path(__file__).resolve().parents[3] / "docs" / "eval-report.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report.to_markdown(), encoding="utf-8")
    return report
