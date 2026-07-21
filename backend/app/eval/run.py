"""CLI entry: python -m app.eval.run"""

from __future__ import annotations

import json
import sys

from app.eval.metrics import run_evaluation, write_report


def main() -> int:
    report = write_report()
    lt = report.hero_lead_time
    summary = {
        "case_count": report.case_count,
        "positive_count": report.positive_count,
        "single_sensor_fn_rate": report.single_sensor.false_negative_rate,
        "forecast_fn_rate": report.forecast.false_negative_rate,
        "compound_fn_rate": report.compound.false_negative_rate,
        "fn_reduction_pct": report.fn_reduction_pct,
        "hero_case_id": report.hero_case_id,
        "hero_lead_time_minutes": (lt.lead_time_minutes if lt is not None else None),
        "hero_t_forecast_minutes": (lt.t_forecast_minutes if lt is not None else None),
        "hero_t_compound_minutes": (lt.t_compound_minutes if lt is not None else None),
        "hero_t_single_sensor_minutes": (
            lt.t_single_sensor_minutes if lt is not None else None
        ),
    }
    print(json.dumps(summary, indent=2))
    print(f"\nReport written to docs/eval-report.md", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
