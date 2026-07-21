"""Confusion matrix, false-negative rate, and report generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from app.eval.dataset import EvalCase, build_dataset, hero_checkpoint
from app.eval.detectors import compound_alarm, forecast_alarm, single_sensor_alarm
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
    forecast: DetectorMetrics
    compound: DetectorMetrics
    case_results: list[CaseResult] = field(default_factory=list)
    fn_reduction_pct: float = 0.0
    hero_case_id: str = "vsp_coke_oven_step2"
    hero_lead_time: ScenarioLeadTime | None = None

    @property
    def case_count(self) -> int:
        return len(self.case_results)

    @property
    def positive_count(self) -> int:
        return sum(1 for r in self.case_results if r.dangerous)

    def to_markdown(self) -> str:
        n, pos = self.case_count, self.positive_count
        lines = [
            "# Compound vs Single-Sensor Evaluation",
            "",
            "Headline metric: **false-negative rate** on cases where a statutory",
            "stop-work provision applies.",
            "",
            "## How cases are labeled",
            "",
            "Ground truth comes from `app/eval/hazard_ground_truth.py`, which reads raw",
            "context payloads against stop-work criteria drawn from the applicable",
            "provisions (Factories Act 1948 s.41B/s.41C, OISD-STD-105 including SIMOPS).",
            "It does **not** import or call the risk policy it scores — enforced by",
            "`tests/test_eval_independence.py`.",
            "",
            "This replaces the previous labeling function, which defined a case as",
            "dangerous exactly when the compound engine fired, making a 0% false-negative",
            "rate true by construction.",
            "",
            f"**Dataset:** {n} cases — {pos} requiring stop-work ({pos / n:.0%}), "
            f"{n - pos} safe ({(n - pos) / n:.0%}). Cases come from a parameter sweep over",
            "atmosphere level and trajectory, permit/isolation state, concurrent",
            "operations, personnel presence and process temperature, plus scripted",
            "scenario timelines.",
            "",
            "## Summary",
            "",
            "| Detector | Accuracy | Recall | FN rate | Precision |",
            "| --- | ---: | ---: | ---: | ---: |",
        ]
        for m in (self.single_sensor, self.forecast, self.compound):
            lines.append(
                f"| {m.name} | {m.accuracy:.1%} | {m.recall:.1%} | "
                f"{m.false_negative_rate:.1%} | {m.precision:.1%} |"
            )
        lines.extend(
            [
                "",
                f"**FN reduction (compound vs single-sensor):** {self.fn_reduction_pct:.1f}%",
                "",
                "### What this measures, and what it does not",
                "",
                "This is a **criterion-coverage** measurement: of the plant states where a",
                "regulation requires stopping work, how many does each detector catch? The",
                "compound engine implements those provisions, so high recall is expected —",
                "the meaningful comparison is against the single-sensor baseline scored on",
                "the *same* labels, which is how a conventional SCADA threshold alarm",
                f"performs: it misses {self.single_sensor.fn:d} of {pos} stop-work cases.",
                "",
                "It is **not** a claim about generalizing to unseen real-world incidents.",
                f"The {self.compound.fp:d} compound false positives are cases where the engine",
                "is deliberately more conservative than the statutory minimum (for example,",
                "hot work with unverified isolation and personnel present, at a clean gas",
                "reading). For a stop-work system that is a defensible bias, not a defect.",
                "",
            ]
        )
        lt = self.hero_lead_time
        if lt and lt.lead_time_minutes is not None:
            forecast_bit = (
                f"forecast alarm at **t+{lt.t_forecast_minutes:.0f} min**, "
                if lt.t_forecast_minutes is not None
                else ""
            )
            lines.extend(
                [
                    "## Prediction lead time (hero scenario)",
                    "",
                    "Measured in **plant process time** from each scenario step's",
                    "`t_offset_minutes` — not the simulator's playback pacing.",
                    "",
                    f"VSP coke-oven timeline: {forecast_bit}compound alarm at "
                    f"**t+{lt.t_compound_minutes:.0f} min**, single-sensor critical at "
                    f"**t+{lt.t_single_sensor_minutes:.0f} min** → "
                    f"**{lt.lead_time_minutes:.0f} minutes of lead time** before the "
                    "incident threshold.",
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
                "Scenario and named cases; the parameter sweep is omitted for length.",
                "",
                "| Case | Stop-work required | Single | Compound | Compound-only catch |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for r in self.case_results:
            if r.case_id.startswith("sweep_"):
                continue
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
    forecast, _ = _confusion(
        cases, name="Predictive forecast (ML trend)", alarm_fn=forecast_alarm
    )
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
        forecast=forecast,
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
