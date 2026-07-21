"""Deterministic evidence-linked reasoning factors for assessment Why sections."""

from __future__ import annotations

from typing import Any, Callable

from app.core.config import get_settings
from shared.python.schemas import (
    AreaOwner,
    DerivedFact,
    ReasoningFactor,
    RetrievedReference,
)

FACT_HEADLINES: dict[str, str] = {
    "elevated_gas": "Elevated gas",
    "critical_gas": "Critical gas (incident threshold)",
    "permit_conflict": "Permit conflict",
    "zone_occupied": "Zone occupied",
    "incomplete_isolation": "Incomplete isolation",
    "simultaneous_ops": "Simultaneous operations",
    "certification_expiring": "Certification expiring",
    "over_temperature": "Over temperature",
    "critical_temperature": "Critical temperature (incident threshold)",
    "equipment_vibration_anomaly": "Equipment vibration anomaly",
    "effluent_quality_breach": "Effluent quality breach",
    "tank_level_critical": "Tank level critical",
    "ppe_noncompliance": "PPE noncompliance",
    "lifting_operation_conflict": "Lifting operation conflict",
    "weather_hold": "Weather hold",
    "predicted_trend_risk": "Rising sensor trend",
    "supervisor_safety_hazard": "Supervisor safety report",
    "supervisor_equipment_issue": "Supervisor equipment report",
    "supervisor_permit_issue": "Supervisor permit report",
    "supervisor_environmental_issue": "Supervisor environmental report",
    "supervisor_personnel_issue": "Supervisor personnel report",
    "supervisor_floor_report": "Supervisor floor report",
}

# Metric facts that should always prefer reading-vs-limit copy.
METRIC_FACT_TYPES = frozenset(
    {
        "elevated_gas",
        "critical_gas",
        "over_temperature",
        "critical_temperature",
        "equipment_vibration_anomaly",
        "effluent_quality_breach",
        "tank_level_critical",
        "weather_hold",
    }
)


def _refs_for_fact(
    fact_type: str, refs: list[RetrievedReference]
) -> list[RetrievedReference]:
    matched = [r for r in refs if r.triggered_by_fact == fact_type]
    if matched:
        return matched
    from app.assessment.retrieval.deterministic import RETRIEVAL_RULES

    sources = set(RETRIEVAL_RULES.get(fact_type, []))
    return [r for r in refs if r.source in sources]


def _normalize_unit(unit: str | None, *, default: str) -> str:
    raw = (unit or default).strip()
    if raw.upper() in {"C", "DEG C", "DEGC", "CELSIUS"}:
        return "°C"
    if raw.upper() in {"F", "DEG F", "DEGF", "FAHRENHEIT"}:
        return "°F"
    return raw


def _payload_reading(
    payload: dict[str, Any], field: str
) -> float | None:
    reading = payload.get(field)
    if isinstance(reading, (int, float)):
        return float(reading)
    return None


def _find_metric_reading(
    entries: list[dict[str, Any]],
    field: str,
    *,
    category: str = "sensor",
    source_ids: list | None = None,
    qualifies: Callable[[float], bool] | None = None,
    default_unit: str = "",
    prefer: str = "max",
) -> tuple[float, str] | None:
    """Return (reading, unit) from source ids first, else best qualifying entry."""

    def unit_of(payload: dict[str, Any]) -> str:
        return _normalize_unit(payload.get("unit"), default=default_unit)

    def ok(val: float) -> bool:
        return qualifies(val) if qualifies is not None else True

    id_set = {str(i) for i in (source_ids or [])}
    if id_set:
        for e in entries:
            if str(e.get("id")) not in id_set:
                continue
            if e.get("category") != category:
                continue
            payload = e.get("payload") or {}
            val = _payload_reading(payload, field)
            if val is None or not ok(val):
                continue
            return val, unit_of(payload)

    best: tuple[float, str] | None = None
    for e in entries:
        if e.get("category") != category:
            continue
        payload = e.get("payload") or {}
        val = _payload_reading(payload, field)
        if val is None or not ok(val):
            continue
        unit = unit_of(payload)
        if best is None:
            best = (val, unit)
        elif prefer == "max" and val > best[0]:
            best = (val, unit)
        elif prefer == "min" and val < best[0]:
            best = (val, unit)
        elif prefer == "first":
            continue
    return best


def _gas_detail(
    entries: list[dict[str, Any]],
    asset_name: str,
    threshold: float,
    *,
    label: str = "action",
    source_ids: list | None = None,
    above: float | None = None,
    at_least: float | None = None,
) -> str:
    def qualifies(reading: float) -> bool:
        if at_least is not None and reading < at_least:
            return False
        if above is not None and reading <= above:
            return False
        return True

    hit = _find_metric_reading(
        entries,
        "gas_reading",
        source_ids=source_ids,
        qualifies=qualifies,
        default_unit="ppm",
    )
    if hit is not None:
        reading, unit = hit
        return (
            f"Gas reading {reading:g} {unit} exceeds the {threshold:g} {unit} "
            f"{label} threshold on {asset_name}."
        )
    return f"Gas readings exceed the {label} threshold on {asset_name}."


def _temp_detail(
    entries: list[dict[str, Any]],
    asset_name: str,
    threshold: float,
    *,
    label: str = "safe-band",
    source_ids: list | None = None,
    above: float | None = None,
    at_least: float | None = None,
) -> str:
    def qualifies(reading: float) -> bool:
        if at_least is not None and reading < at_least:
            return False
        if above is not None and reading <= above:
            return False
        return True

    hit = _find_metric_reading(
        entries,
        "temp_reading",
        source_ids=source_ids,
        qualifies=qualifies,
        default_unit="°C",
    )
    if hit is not None:
        reading, unit = hit
        return (
            f"Process temperature {reading:g} {unit} exceeds the "
            f"{threshold:g} {unit} {label} limit on {asset_name}."
        )
    return f"Process temperature exceeds the {label} limit on {asset_name}."


def _vibration_detail(
    entries: list[dict[str, Any]],
    asset_name: str,
    threshold: float,
    *,
    source_ids: list | None = None,
) -> str:
    hit = _find_metric_reading(
        entries,
        "vibration_mm_s",
        source_ids=source_ids,
        qualifies=lambda v: v > threshold,
        default_unit="mm/s",
    )
    if hit is not None:
        reading, unit = hit
        return (
            f"Vibration {reading:g} {unit} exceeds the {threshold:g} {unit} "
            f"ISO anomaly limit on {asset_name}."
        )
    return f"Vibration severity exceeds the ISO anomaly limit on {asset_name}."


def _effluent_detail(
    entries: list[dict[str, Any]],
    asset_name: str,
    ph_min: float,
    ph_max: float,
    *,
    source_ids: list | None = None,
) -> str:
    hit = _find_metric_reading(
        entries,
        "ph",
        source_ids=source_ids,
        qualifies=lambda v: v < ph_min or v > ph_max,
        default_unit="",
        prefer="first",
    )
    if hit is not None:
        reading, _unit = hit
        if reading < ph_min:
            return (
                f"Effluent pH {reading:g} is below the {ph_min:g}–{ph_max:g} "
                f"discharge band on {asset_name}."
            )
        return (
            f"Effluent pH {reading:g} is above the {ph_min:g}–{ph_max:g} "
            f"discharge band on {asset_name}."
        )
    return (
        f"Effluent pH is outside the {ph_min:g}–{ph_max:g} discharge band "
        f"on {asset_name}."
    )


def _tank_level_detail(
    entries: list[dict[str, Any]],
    asset_name: str,
    high_pct: float,
    low_pct: float,
    *,
    source_ids: list | None = None,
) -> str:
    high = _find_metric_reading(
        entries,
        "level_pct",
        source_ids=source_ids,
        qualifies=lambda v: v > high_pct,
        default_unit="%",
        prefer="max",
    )
    if high is not None:
        reading, unit = high
        u = unit if unit and unit != "%" else "%"
        return (
            f"Tank level {reading:g}{u} exceeds the {high_pct:g}% high setpoint "
            f"on {asset_name}."
        )
    low = _find_metric_reading(
        entries,
        "level_pct",
        source_ids=source_ids,
        qualifies=lambda v: v < low_pct,
        default_unit="%",
        prefer="min",
    )
    if low is not None:
        reading, unit = low
        u = unit if unit and unit != "%" else "%"
        return (
            f"Tank level {reading:g}{u} is below the {low_pct:g}% low setpoint "
            f"on {asset_name}."
        )
    return f"Tank level is outside the {low_pct:g}–{high_pct:g}% operating band on {asset_name}."


def _weather_detail(
    entries: list[dict[str, Any]],
    asset_name: str,
    wind_threshold: float,
    *,
    source_ids: list | None = None,
) -> str:
    del source_ids  # Weather facts cite permits/lifts too — scan all weather rows.
    for e in entries:
        if e.get("category") != "weather":
            continue
        payload = e.get("payload") or {}
        if payload.get("lightning") is True:
            return (
                f"Lightning is active with exposed work near {asset_name}; "
                "hold hot work and outdoor lifts."
            )
        wind = payload.get("wind_ms")
        if isinstance(wind, (int, float)) and float(wind) >= wind_threshold:
            return (
                f"Wind {float(wind):g} m/s exceeds the {wind_threshold:g} m/s "
                f"hold limit with exposed work active near {asset_name}."
            )
    return (
        f"Weather hold criteria are breached with exposed work near {asset_name}."
    )


def _worker_detail(entries: list[dict[str, Any]], asset_name: str) -> str:
    names: list[str] = []
    for e in entries:
        if e.get("category") != "worker_location":
            continue
        payload = e.get("payload") or {}
        name = payload.get("worker_name") or payload.get("worker_id") or "Unknown worker"
        zone = payload.get("zone") or "hazardous"
        names.append(f"{name} in {zone}")
    if names:
        return (
            f"{', '.join(names)} — personnel present in a hazardous zone near {asset_name}."
        )
    return f"Workers are present in a hazard-flagged zone near {asset_name}."


def _permit_detail(entries: list[dict[str, Any]], asset_name: str) -> str:
    permits: list[str] = []
    for e in entries:
        if e.get("category") != "permit":
            continue
        payload = e.get("payload") or {}
        if payload.get("status") != "active":
            continue
        pid = payload.get("permit_id") or "?"
        work = payload.get("work_type") or "work"
        permits.append(f"{pid} ({work})")
    if len(permits) >= 2:
        return (
            f"Active overlapping permits on {asset_name}: {', '.join(permits)}. "
            "Work windows must be reconciled before restart."
        )
    if permits:
        return f"Active permit {permits[0]} on {asset_name} conflicts with concurrent activity."
    return f"Conflicting permits overlap incompatibly on {asset_name}."


def _isolation_detail(asset_name: str) -> str:
    return (
        f"Isolation boundaries are incomplete or unverified for hazardous work on {asset_name}."
    )


def _simops_detail(asset_name: str) -> str:
    return (
        f"Incompatible simultaneous operations are active on {asset_name} "
        "and require SIMOPS coordination."
    )


def _cert_detail(entries: list[dict[str, Any]], asset_name: str) -> str:
    workers: list[str] = []
    for e in entries:
        if e.get("category") != "certification":
            continue
        payload = e.get("payload") or {}
        name = payload.get("worker_name") or payload.get("worker_id") or "a worker"
        workers.append(str(name))
    if workers:
        return (
            f"Certification for {', '.join(workers)} is within the expiry warning window "
            f"while work is active near {asset_name}."
        )
    return f"Worker certifications are approaching expiry during active work near {asset_name}."


def _predicted_trend_detail(asset_name: str) -> str:
    return (
        f"Sensor trajectory projects an elevated-threshold crossing soon on {asset_name}; "
        "stage controls before the hard alarm line."
    )


def format_predicted_trend_detail(
    *,
    asset_name: str,
    metric: str,
    slope_per_min: float,
    r_squared: float,
    seconds_to_elevated: float | None,
    seconds_to_critical: float | None,
) -> str:
    """Human-readable deterministic forecast explanation for the Why panel."""

    def fmt_eta(seconds: float | None) -> str:
        if seconds is None:
            return "n/a"
        if seconds <= 0:
            return "now"
        if seconds < 60:
            return f"~{int(round(seconds))}s"
        mins = int(round(seconds / 60.0))
        return "~1 min" if mins == 1 else f"~{mins} min"

    metric_label = {
        "gas_reading": "gas",
        "temp_reading": "temperature",
        "vibration_mm_s": "vibration",
    }.get(str(metric), str(metric).replace("_", " "))
    eta_elev = fmt_eta(seconds_to_elevated)
    eta_crit = fmt_eta(seconds_to_critical)
    return (
        f"{metric_label.title()} rising {slope_per_min:.1f}/min (R²={r_squared:.2f}) — "
        f"elevated in {eta_elev}, critical in {eta_crit} on {asset_name}."
    )


def _generic_fact_detail(fact_type: str, headline: str, asset_name: str) -> str:
    """Operator-facing fallback — never expose internal 'derived fact' jargon."""
    from app.risk.recommendations import FACT_RECOMMENDATIONS

    _text, rationale = FACT_RECOMMENDATIONS.get(fact_type, ("", ""))
    if rationale:
        return rationale
    return f"{headline} is active on {asset_name} and needs supervisor attention."


def format_fact_detail(
    fact_type: str,
    context_entries: list[dict[str, Any]],
    *,
    asset_name: str = "this asset",
    source_ids: list | None = None,
    area_owner: AreaOwner | None = None,
) -> str:
    """Public reading-vs-limit (or structured) copy for Why, agents, and rationales."""
    settings = get_settings()
    headline = FACT_HEADLINES.get(fact_type, fact_type.replace("_", " ").title())
    ids = list(source_ids) if source_ids is not None else None

    if fact_type == "elevated_gas":
        return _gas_detail(
            context_entries,
            asset_name,
            settings.gas_elevated_threshold,
            source_ids=ids,
            above=settings.gas_elevated_threshold,
        )
    if fact_type == "critical_gas":
        return _gas_detail(
            context_entries,
            asset_name,
            settings.gas_critical_threshold,
            label="critical",
            source_ids=ids,
            at_least=settings.gas_critical_threshold,
        )
    if fact_type == "over_temperature":
        return _temp_detail(
            context_entries,
            asset_name,
            settings.temp_elevated_threshold,
            label="safe-band",
            source_ids=ids,
            above=settings.temp_elevated_threshold,
        )
    if fact_type == "critical_temperature":
        return _temp_detail(
            context_entries,
            asset_name,
            settings.temp_critical_threshold,
            label="critical",
            source_ids=ids,
            at_least=settings.temp_critical_threshold,
        )
    if fact_type == "equipment_vibration_anomaly":
        return _vibration_detail(
            context_entries,
            asset_name,
            settings.vibration_anomaly_threshold,
            source_ids=ids,
        )
    if fact_type == "effluent_quality_breach":
        return _effluent_detail(
            context_entries,
            asset_name,
            settings.effluent_ph_min,
            settings.effluent_ph_max,
            source_ids=ids,
        )
    if fact_type == "tank_level_critical":
        return _tank_level_detail(
            context_entries,
            asset_name,
            settings.tank_level_high_pct,
            settings.tank_level_low_pct,
            source_ids=ids,
        )
    if fact_type == "weather_hold":
        return _weather_detail(
            context_entries,
            asset_name,
            settings.weather_wind_hold_ms,
            source_ids=ids,
        )
    if fact_type == "zone_occupied":
        detail = _worker_detail(context_entries, asset_name)
        if area_owner:
            detail += f" Area owner: {area_owner.name} ({area_owner.role})."
        return detail
    if fact_type == "permit_conflict":
        return _permit_detail(context_entries, asset_name)
    if fact_type == "incomplete_isolation":
        return _isolation_detail(asset_name)
    if fact_type == "simultaneous_ops":
        return _simops_detail(asset_name)
    if fact_type == "certification_expiring":
        return _cert_detail(context_entries, asset_name)
    if fact_type == "predicted_trend_risk":
        return _predicted_trend_detail(asset_name)
    if fact_type in {
        "supervisor_safety_hazard",
        "supervisor_equipment_issue",
        "supervisor_permit_issue",
        "supervisor_environmental_issue",
        "supervisor_personnel_issue",
        "supervisor_floor_report",
    }:
        return _supervisor_report_detail(context_entries, asset_name)
    return _generic_fact_detail(fact_type, headline, asset_name)


def _supervisor_report_detail(
    context_entries: list[dict[str, Any]], asset_name: str
) -> str:
    latest: dict[str, Any] | None = None
    latest_from: str | None = None
    for entry in context_entries:
        if entry.get("category") != "supervisor_report":
            continue
        payload = entry.get("payload") or {}
        desc = str(payload.get("description") or "").strip()
        if not desc:
            continue
        valid_from = str(entry.get("valid_from") or "")
        if latest_from is None or valid_from >= latest_from:
            latest = payload
            latest_from = valid_from
    if latest is None:
        return f"A supervisor reported a concern on {asset_name}."
    reporter = str(latest.get("reported_by") or "Supervisor")
    concern = str(latest.get("concern_type") or "other").replace("_", " ")
    desc = str(latest.get("description") or "").strip()
    return f'{reporter} reported ({concern}): "{desc}"'


def build_reasoning_factors(
    facts: list[DerivedFact],
    context_entries: list[dict[str, Any]],
    enriched_refs: list[RetrievedReference],
    *,
    asset_name: str = "this asset",
    area_owner: AreaOwner | None = None,
) -> list[ReasoningFactor]:
    """Build structured Why factors from facts + live context + enriched refs."""
    active_types = {f.fact_type for f in facts}
    factors: list[ReasoningFactor] = []

    for fact in sorted(facts, key=lambda f: f.fact_type):
        ft = fact.fact_type
        # Critical sensor line supersedes the softer elevated band in Why text.
        if ft == "elevated_gas" and "critical_gas" in active_types:
            continue
        if ft == "over_temperature" and "critical_temperature" in active_types:
            continue

        headline = FACT_HEADLINES.get(ft, ft.replace("_", " ").title())
        detail = format_fact_detail(
            ft,
            context_entries,
            asset_name=asset_name,
            source_ids=list(fact.source_context_ids),
            area_owner=area_owner,
        )

        evidence = _refs_for_fact(ft, enriched_refs)
        factors.append(
            ReasoningFactor(
                fact_type=ft,
                headline=headline,
                detail=detail,
                evidence=evidence,
                context_ids=list(fact.source_context_ids),
            )
        )
    return factors


def serialize_factor(factor: ReasoningFactor) -> dict:
    from app.assessment.retrieval.enrich import serialize_ref

    return {
        "fact_type": factor.fact_type,
        "headline": factor.headline,
        "detail": factor.detail,
        "evidence": [serialize_ref(r) for r in factor.evidence],
        "context_ids": [str(i) for i in factor.context_ids],
    }
