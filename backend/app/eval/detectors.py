"""Single-sensor baseline vs compound fusion detectors."""

from __future__ import annotations

from app.agents.nodes.orchestrator import _fuse_risk
from app.assessment.providers.mock import CRITICAL_SENSOR_FACTS
from app.context.lead_time import forecast_asset_trends
from app.context.derived_facts import ContextEntryView, evaluate_rules
from app.core.config import get_settings


def active_fact_types(entries: list[ContextEntryView]) -> set[str]:
    evaluations = evaluate_rules(entries)
    return {name for name, fact in evaluations.items() if fact is not None}


def single_sensor_alarm(entries: list[ContextEntryView]) -> bool:
    """
    Traditional SCADA baseline: alarm only when a sensor crosses its
    critical/incident threshold (OR across critical sensor facts).
    """
    return bool(active_fact_types(entries) & CRITICAL_SENSOR_FACTS)


def compound_alarm(entries: list[ContextEntryView]) -> bool:
    """
    SOP Opera compound engine: derived facts fused to a blocking verdict.
    """
    grounded = sorted(active_fact_types(entries) - {"spatial_cooccurrence"})
    return _fuse_risk(grounded, []) == "blocking"


def forecast_alarm(entries: list[ContextEntryView]) -> bool:
    """
    Forecast baseline: high-confidence rising trajectory reaches elevated threshold
    within the configured horizon.
    """
    settings = get_settings()
    horizon_seconds = max(0.0, float(settings.predictive_trend_horizon_minutes) * 60.0)
    forecasts = forecast_asset_trends(
        entries, min_points=int(settings.predictive_trend_min_samples)
    )
    for fc in forecasts:
        if (
            fc.trend == "rising"
            and fc.r_squared >= float(settings.predictive_trend_min_r2)
            and fc.seconds_to_elevated is not None
            and 0.0 <= fc.seconds_to_elevated <= horizon_seconds
        ):
            return True

    # Fallback early warning when we don't have enough samples for OLS yet.
    # This keeps the demo narrative useful on sparse timelines: elevated gas
    # + active hot-work is treated as imminent in-horizon risk.
    has_hot_work = any(
        e.category == "permit"
        and (e.payload or {}).get("status") == "active"
        and (e.payload or {}).get("work_type") == "hot_work"
        for e in entries
    )
    has_elevated_gas = any(
        e.category == "sensor"
        and (e.payload or {}).get("gas_reading") is not None
        and isinstance((e.payload or {}).get("gas_reading"), (int, float))
        and float((e.payload or {}).get("gas_reading"))
        >= float(settings.gas_elevated_threshold)
        for e in entries
    )
    return has_hot_work and has_elevated_gas
