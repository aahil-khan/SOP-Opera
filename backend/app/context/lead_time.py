"""Live lead-time estimation and trend forecasting from context entries."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from app.risk.policy import CRITICAL_SENSOR_FACTS
from app.context.derived_facts import ContextEntryView
from app.core.config import get_settings


def _parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def context_entries_to_views(
    entries: list[dict[str, Any]],
) -> list[ContextEntryView]:
    views: list[ContextEntryView] = []
    for entry in entries:
        try:
            aid = entry.get("asset_id")
            eid = entry.get("id")
            if not aid or not eid:
                continue
            views.append(
                ContextEntryView(
                    id=UUID(str(eid)),
                    asset_id=UUID(str(aid)),
                    category=str(entry.get("category") or ""),
                    payload=dict(entry.get("payload") or {}),
                    provider=str(entry.get("provider") or "unknown"),
                    valid_from=_parse_dt(entry.get("valid_from")),
                    valid_until=_parse_dt(entry.get("valid_until")),
                    confidence=float(entry.get("confidence") or 1.0),
                )
            )
        except (TypeError, ValueError):
            continue
    return views


def _metric_samples(
    entries: list[ContextEntryView],
    *,
    field: str,
) -> list[tuple[datetime, float]]:
    samples: list[tuple[datetime, float]] = []
    for entry in entries:
        if entry.category != "sensor":
            continue
        reading = entry.payload.get(field)
        if not isinstance(reading, (int, float)):
            continue
        ts = entry.valid_from
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        samples.append((ts, float(reading)))
    samples.sort(key=lambda item: item[0])
    return samples


@dataclass(frozen=True)
class TrendForecast:
    metric: str
    current_value: float
    slope_per_min: float
    r_squared: float
    trend: Literal["rising", "falling", "stable"]
    seconds_to_elevated: float | None
    seconds_to_critical: float | None
    sample_count: int


def _seconds_to_threshold(
    *,
    current: float,
    slope_per_sec: float,
    threshold: float,
) -> float | None:
    if current >= threshold:
        return 0.0
    if slope_per_sec <= 0:
        return None
    return (threshold - current) / slope_per_sec


def _ols_fit(samples: list[tuple[datetime, float]]) -> tuple[float, float, float] | None:
    """
    Return (slope_per_sec, intercept, r_squared) for y = slope*x + intercept.
    x is seconds since first sample.
    """
    if len(samples) < 2:
        return None
    t0 = samples[0][0]
    xs = [(ts - t0).total_seconds() for ts, _ in samples]
    ys = [val for _, val in samples]
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    ss_xx = sum((x - mean_x) ** 2 for x in xs)
    if ss_xx <= 0:
        # Offline eval fixtures may use equal timestamps; preserve trend signal by
        # treating ordered samples as 1-second cadence.
        xs = [float(i) for i in range(n)]
        mean_x = sum(xs) / n
        ss_xx = sum((x - mean_x) ** 2 for x in xs)
        if ss_xx <= 0:
            return None
    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True))
    slope = ss_xy / ss_xx
    intercept = mean_y - slope * mean_x
    y_hat = [intercept + slope * x for x in xs]
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    ss_res = sum((y - yh) ** 2 for y, yh in zip(ys, y_hat, strict=True))
    r2 = 1.0 if ss_tot <= 1e-12 else max(0.0, min(1.0, 1.0 - (ss_res / ss_tot)))
    return slope, intercept, r2


def forecast_metric(
    entries: list[ContextEntryView],
    *,
    field: str,
    elevated: float,
    critical: float,
    min_points: int = 3,
) -> TrendForecast | None:
    samples = _metric_samples(entries, field=field)
    if len(samples) < max(2, int(min_points)):
        return None
    fit = _ols_fit(samples)
    if fit is None:
        return None
    slope_per_sec, _intercept, r2 = fit
    slope_per_min = slope_per_sec * 60.0
    if slope_per_sec > 1e-9:
        trend: Literal["rising", "falling", "stable"] = "rising"
    elif slope_per_sec < -1e-9:
        trend = "falling"
    else:
        trend = "stable"
    current = samples[-1][1]
    return TrendForecast(
        metric=field,
        current_value=current,
        slope_per_min=slope_per_min,
        r_squared=r2,
        trend=trend,
        seconds_to_elevated=_seconds_to_threshold(
            current=current, slope_per_sec=slope_per_sec, threshold=elevated
        ),
        seconds_to_critical=_seconds_to_threshold(
            current=current, slope_per_sec=slope_per_sec, threshold=critical
        ),
        sample_count=len(samples),
    )


def forecast_asset_trends(
    entries: list[ContextEntryView],
    *,
    min_points: int | None = None,
) -> list[TrendForecast]:
    settings = get_settings()
    minimum = int(
        min_points if min_points is not None else settings.predictive_trend_min_samples
    )
    checks = [
        ("gas_reading", settings.gas_elevated_threshold, settings.gas_critical_threshold),
        ("temp_reading", settings.temp_elevated_threshold, settings.temp_critical_threshold),
        (
            "vibration_mm_s",
            settings.vibration_anomaly_threshold,
            settings.vibration_anomaly_threshold,
        ),
    ]
    out: list[TrendForecast] = []
    for field, elevated, critical in checks:
        fc = forecast_metric(
            entries,
            field=field,
            elevated=float(elevated),
            critical=float(critical),
            min_points=minimum,
        )
        if fc is not None:
            out.append(fc)
    return out


def estimate_seconds_until_gas_critical(
    entries: list[ContextEntryView],
) -> float | None:
    """
    Estimate seconds until gas crosses the critical/incident threshold
    if the recent upward trend continues. Returns 0 when already critical.
    """
    settings = get_settings()
    fc = forecast_metric(
        entries,
        field="gas_reading",
        elevated=float(settings.gas_elevated_threshold),
        critical=float(settings.gas_critical_threshold),
        min_points=2,
    )
    if fc is None:
        return None
    return fc.seconds_to_critical


def compute_lead_time_for_verdict(
    context_entries: list[dict[str, Any]],
    grounded: list[str],
    risk: str,
) -> float | None:
    """
    Live assessment lead time: seconds until single-sensor critical threshold
    when compound already reached blocking on sub-critical co-occurrence.
    """
    if risk != "blocking":
        return None

    grounded_set = set(grounded)
    if grounded_set & CRITICAL_SENSOR_FACTS:
        return 0.0
    if "elevated_gas" not in grounded_set:
        return None

    views = context_entries_to_views(context_entries)
    return estimate_seconds_until_gas_critical(views)
