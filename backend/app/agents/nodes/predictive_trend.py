"""Predictive Trend Agent — projects near-term threshold crossings from telemetry."""

from __future__ import annotations

from typing import Any

from app.agents.events import make_step
from app.agents.state import AgentObservation, AgentState
from app.context.lead_time import TrendForecast, context_entries_to_views, forecast_asset_trends
from app.core.config import get_settings


_METRIC_LABELS: dict[str, str] = {
    "gas_reading": "gas",
    "temp_reading": "temperature",
    "vibration_mm_s": "vibration",
}


def _fmt_eta(seconds: float | None) -> str:
    if seconds is None:
        return "n/a"
    if seconds <= 0:
        return "now"
    if seconds < 60:
        return f"~{int(round(seconds))}s"
    mins = int(round(seconds / 60.0))
    return "~1 min" if mins == 1 else f"~{mins} min"


def _early_warning_context(state: AgentState, threshold: float) -> bool:
    """Elevated gas co-occurring with active hot work — sparse-data anticipatory signal."""
    entries = list(state.get("context_entries") or [])
    has_hot_work = any(
        e.get("category") == "permit"
        and (e.get("payload") or {}).get("status") == "active"
        and (e.get("payload") or {}).get("work_type") == "hot_work"
        for e in entries
    )
    if not has_hot_work:
        return False
    for e in entries:
        if e.get("category") != "sensor":
            continue
        reading = (e.get("payload") or {}).get("gas_reading")
        if isinstance(reading, (int, float)) and float(reading) >= threshold:
            return True
    return False


def _select_forecast_hit(
    forecasts: list[TrendForecast],
    *,
    min_r2: float,
    horizon_seconds: float,
    already_grounded: set[str],
) -> TrendForecast | None:
    """Pick the most urgent rising forecast (critical lead time beats elevated)."""
    supports_predictive = {
        "gas_reading": "elevated_gas",
        "temp_reading": "over_temperature",
        "vibration_mm_s": "equipment_vibration_anomaly",
    }
    candidates: list[tuple[float, TrendForecast]] = []
    for fc in forecasts:
        if fc.trend != "rising" or fc.r_squared < min_r2:
            continue
        critical_eta = fc.seconds_to_critical
        elevated_eta = fc.seconds_to_elevated
        if (
            critical_eta is not None
            and 0.0 <= critical_eta <= horizon_seconds
        ):
            candidates.append((critical_eta, fc))
            continue
        grounded = supports_predictive.get(fc.metric)
        if (
            grounded not in already_grounded
            and elevated_eta is not None
            and 0.0 <= elevated_eta <= horizon_seconds
        ):
            candidates.append((elevated_eta + 1e6, fc))
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: item[0])[0][1]


async def predictive_trend_agent(state: AgentState) -> dict[str, Any]:
    review_id = state.get("review_id")
    assessment_id = state.get("assessment_id")
    settings = get_settings()
    horizon_seconds = max(0.0, float(settings.predictive_trend_horizon_minutes) * 60.0)
    min_r2 = float(settings.predictive_trend_min_r2)
    min_samples = int(settings.predictive_trend_min_samples)

    started = make_step(
        "predictive_trend",
        "started",
        "Fitting sensor trajectories for threshold crossings",
        review_id=review_id,
        assessment_id=assessment_id,
    )

    views = context_entries_to_views(list(state.get("context_entries") or []))
    forecasts = forecast_asset_trends(views, min_points=min_samples)
    tool = make_step(
        "predictive_trend",
        "tool_call",
        f"OLS fit on {len(forecasts)} sensor metric(s)",
        review_id=review_id,
        assessment_id=assessment_id,
        detail={
            "metric_count": len(forecasts),
            "horizon_minutes": settings.predictive_trend_horizon_minutes,
            "min_r2": min_r2,
            "min_samples": min_samples,
            "forecasts": [
                {
                    "metric": f.metric,
                    "current_value": f.current_value,
                    "slope_per_min": f.slope_per_min,
                    "r_squared": f.r_squared,
                    "seconds_to_elevated": f.seconds_to_elevated,
                    "seconds_to_critical": f.seconds_to_critical,
                    "sample_count": f.sample_count,
                }
                for f in forecasts
            ],
        },
    )

    already_grounded = set(state.get("fact_types") or [])
    top = _select_forecast_hit(
        forecasts,
        min_r2=min_r2,
        horizon_seconds=horizon_seconds,
        already_grounded=already_grounded,
    )
    fallback = top is None and _early_warning_context(
        state, float(settings.gas_elevated_threshold)
    )

    if top is not None:
        metric = _METRIC_LABELS.get(top.metric, top.metric.replace("_", " "))
        observation = (
            f"{metric.title()} rising {top.slope_per_min:.1f}/min (R²={top.r_squared:.2f}) — "
            f"elevated in {_fmt_eta(top.seconds_to_elevated)}, "
            f"critical in {_fmt_eta(top.seconds_to_critical)} if trend holds."
        )
        risk = "elevated"
        finding = "risk"
        fact_types = ["predicted_trend_risk"]
    elif fallback:
        observation = (
            "Elevated gas with active hot work — anticipatory forecast flagged "
            "before OLS has enough samples to confirm trajectory."
        )
        risk = "elevated"
        finding = "risk"
        fact_types = ["predicted_trend_risk"]
    else:
        observation = "No imminent threshold crossings inside the forecast window."
        risk = "nominal"
        finding = "clearance"
        fact_types = []

    obs: AgentObservation = {
        "agent": "predictive_trend",
        "observation": observation,
        "local_risk": risk,
        "fact_types": fact_types,
        "detail": {
            "finding": finding,
            "forecast_count": len(forecasts),
            "horizon_minutes": settings.predictive_trend_horizon_minutes,
            "min_r2": min_r2,
            "forecasts": [f.__dict__ for f in forecasts],
            "fallback_early_warning": fallback,
        },
    }
    return {
        "observations": [obs],
        "trend_forecasts": [f.__dict__ for f in forecasts],
        "agent_trace": [
            started.model_dump(),
            tool.model_dump(),
            make_step(
                "predictive_trend",
                "observation",
                observation,
                review_id=review_id,
                assessment_id=assessment_id,
                detail=obs["detail"],
                finding=finding,  # type: ignore[arg-type]
            ).model_dump(),
            make_step(
                "predictive_trend",
                "local_risk",
                f"Predictive Trend Agent local risk → {risk}",
                review_id=review_id,
                assessment_id=assessment_id,
                detail={
                    "local_risk": risk,
                    "fallback_early_warning": fallback,
                },
            ).model_dump(),
            make_step(
                "predictive_trend",
                "completed",
                "Predictive Trend Agent complete",
                review_id=review_id,
                assessment_id=assessment_id,
            ).model_dump(),
        ],
    }
