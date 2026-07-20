"""Live lead-time estimation from context entries (no agent imports)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.assessment.providers.mock import CRITICAL_SENSOR_FACTS
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


def _gas_samples(
    entries: list[ContextEntryView],
) -> list[tuple[datetime, float]]:
    samples: list[tuple[datetime, float]] = []
    for entry in entries:
        if entry.category != "sensor":
            continue
        reading = entry.payload.get("gas_reading")
        if not isinstance(reading, (int, float)):
            continue
        ts = entry.valid_from
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        samples.append((ts, float(reading)))
    samples.sort(key=lambda item: item[0])
    return samples


def estimate_seconds_until_gas_critical(
    entries: list[ContextEntryView],
) -> float | None:
    """
    Estimate seconds until gas crosses the critical/incident threshold
    if the recent upward trend continues. Returns 0 when already critical.
    """
    settings = get_settings()
    critical = settings.gas_critical_threshold
    samples = _gas_samples(entries)
    if not samples:
        return None

    current = samples[-1][1]
    if current >= critical:
        return 0.0

    if len(samples) < 2:
        return None

    t0, v0 = samples[-2]
    t1, v1 = samples[-1]
    dt = (t1 - t0).total_seconds()
    if dt <= 0 or v1 <= v0:
        return None

    rate = (v1 - v0) / dt
    if rate <= 0:
        return None
    return (critical - v1) / rate


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
