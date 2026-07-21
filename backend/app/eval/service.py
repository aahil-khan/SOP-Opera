"""Build API-facing eval summary from the in-memory harness."""

from __future__ import annotations

from app.eval.metrics import DetectorMetrics, EvalReport, run_evaluation
from app.eval.schemas import DetectorSummaryOut, EvalSummaryOut


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
    report = report or run_evaluation()
    lt = report.hero_lead_time
    return EvalSummaryOut(
        fn_reduction_pct=report.fn_reduction_pct,
        hero_case_id=report.hero_case_id,
        hero_lead_time_seconds=(
            lt.lead_time_seconds if lt is not None else None
        ),
        hero_t_forecast_seconds=(
            lt.t_forecast_seconds if lt is not None else None
        ),
        hero_t_compound_seconds=(
            lt.t_compound_seconds if lt is not None else None
        ),
        hero_t_single_sensor_seconds=(
            lt.t_single_sensor_seconds if lt is not None else None
        ),
        single_sensor=_detector_out(report.single_sensor),
        forecast=_detector_out(report.forecast),
        compound=_detector_out(report.compound),
        case_count=len(report.case_results),
        compound_only_catch_count=sum(
            1 for r in report.case_results if r.compound_only_catch
        ),
    )
