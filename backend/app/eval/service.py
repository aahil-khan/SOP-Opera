"""Build API-facing eval summary from the in-memory harness."""

from __future__ import annotations

import time
from datetime import datetime, timezone

from app.eval.metrics import (
    CRITERION_CAVEAT,
    DetectorMetrics,
    EvalReport,
    run_evaluation,
)
from app.eval.schemas import (
    AblationRowOut,
    DetectorSummaryOut,
    EvalSummaryOut,
    ScenarioLeadTimeOut,
)


def _detector_out(m: DetectorMetrics) -> DetectorSummaryOut:
    return DetectorSummaryOut(
        name=m.name,
        accuracy=m.accuracy,
        recall=m.recall,
        false_negative_rate=m.false_negative_rate,
        precision=m.precision,
        tp=m.tp,
        fp=m.fp,
        tn=m.tn,
        fn=m.fn,
    )


def build_eval_summary(report: EvalReport | None = None) -> EvalSummaryOut:
    t0 = time.perf_counter()
    report = report or run_evaluation()
    run_duration_ms = (time.perf_counter() - t0) * 1000.0
    lt = report.hero_lead_time
    dist = report.lead_times
    return EvalSummaryOut(
        lead_times=[
            ScenarioLeadTimeOut(
                scenario=s.scenario,
                t_forecast_minutes=s.t_forecast_minutes,
                t_compound_minutes=s.t_compound_minutes,
                t_single_sensor_minutes=s.t_single_sensor_minutes,
                lead_time_minutes=s.lead_time_minutes,
            )
            for s in (dist.scenarios if dist else ())
        ],
        lead_time_min_minutes=(dist.min_minutes if dist else None),
        lead_time_median_minutes=(dist.median_minutes if dist else None),
        lead_time_max_minutes=(dist.max_minutes if dist else None),
        lead_time_defined_count=(dist.defined_count if dist else 0),
        ablation=[
            AblationRowOut(
                dimension=row.dimension,
                label=row.label,
                facts_removed=list(row.facts_removed),
                recall=row.recall,
                recall_drop=row.recall_drop,
                fn=row.fn,
                tp=row.tp,
            )
            for row in report.ablation
        ],
        criterion_caveat=CRITERION_CAVEAT,
        generated_at=datetime.now(timezone.utc).isoformat(),
        run_duration_ms=round(run_duration_ms, 1),
        fn_reduction_pct=report.fn_reduction_pct,
        hero_case_id=report.hero_case_id,
        hero_lead_time_minutes=(lt.lead_time_minutes if lt is not None else None),
        hero_t_forecast_minutes=(lt.t_forecast_minutes if lt is not None else None),
        hero_t_compound_minutes=(lt.t_compound_minutes if lt is not None else None),
        hero_t_single_sensor_minutes=(
            lt.t_single_sensor_minutes if lt is not None else None
        ),
        single_sensor=_detector_out(report.single_sensor),
        forecast=_detector_out(report.forecast),
        compound=_detector_out(report.compound),
        regulation_coverage_pct=(
            report.coverage.regulation_coverage_pct if report.coverage else 0.0
        ),
        statutory_coverage_pct=(
            report.coverage.statutory_coverage_pct if report.coverage else 0.0
        ),
        coverage_by_standard=(
            dict(report.coverage.per_standard) if report.coverage else {}
        ),
        case_count=report.case_count,
        positive_count=report.positive_count,
        compound_only_catch_count=sum(
            1 for r in report.case_results if r.compound_only_catch
        ),
    )
