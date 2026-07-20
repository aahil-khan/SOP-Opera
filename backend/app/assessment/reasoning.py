"""Deterministic evidence-linked reasoning factors for assessment Why sections."""

from __future__ import annotations

from typing import Any

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
}


def _refs_for_fact(
    fact_type: str, refs: list[RetrievedReference]
) -> list[RetrievedReference]:
    matched = [r for r in refs if r.triggered_by_fact == fact_type]
    if matched:
        return matched
    # Fallback: loosely associate by source type mapping from retrieval rules
    from app.assessment.retrieval.deterministic import RETRIEVAL_RULES

    sources = set(RETRIEVAL_RULES.get(fact_type, []))
    return [r for r in refs if r.source in sources]


def _sensor_reading(
    entries: list[dict[str, Any]], entry_id: str
) -> tuple[float, str] | None:
    for e in entries:
        if str(e.get("id")) != entry_id or e.get("category") != "sensor":
            continue
        payload = e.get("payload") or {}
        reading = payload.get("gas_reading")
        if isinstance(reading, (int, float)):
            unit = str(payload.get("unit") or "ppm")
            return float(reading), unit
    return None


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

    id_set = {str(i) for i in (source_ids or [])}
    if id_set:
        for eid in id_set:
            hit = _sensor_reading(entries, eid)
            if hit is None:
                continue
            reading, unit = hit
            if not qualifies(reading):
                continue
            return (
                f"Gas reading {reading:g} {unit} exceeds the {threshold:g} {unit} "
                f"{label} threshold on {asset_name}."
            )

    best: tuple[float, str] | None = None
    for e in entries:
        if e.get("category") != "sensor":
            continue
        payload = e.get("payload") or {}
        reading = payload.get("gas_reading")
        if not isinstance(reading, (int, float)):
            continue
        val = float(reading)
        if not qualifies(val):
            continue
        unit = str(payload.get("unit") or "ppm")
        if best is None or val > best[0]:
            best = (val, unit)
    if best is not None:
        reading, unit = best
        return (
            f"Gas reading {reading:g} {unit} exceeds the {threshold:g} {unit} "
            f"{label} threshold on {asset_name}."
        )
    return f"Gas readings exceed the {label} threshold on {asset_name}."


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


def build_reasoning_factors(
    facts: list[DerivedFact],
    context_entries: list[dict[str, Any]],
    enriched_refs: list[RetrievedReference],
    *,
    asset_name: str = "this asset",
    area_owner: AreaOwner | None = None,
) -> list[ReasoningFactor]:
    """Build structured Why factors from facts + live context + enriched refs."""
    settings = get_settings()
    threshold = settings.gas_elevated_threshold
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
        if ft == "elevated_gas":
            detail = _gas_detail(
                context_entries,
                asset_name,
                threshold,
                source_ids=list(fact.source_context_ids),
                above=threshold,
            )
        elif ft == "critical_gas":
            detail = _gas_detail(
                context_entries,
                asset_name,
                settings.gas_critical_threshold,
                label="critical",
                source_ids=list(fact.source_context_ids),
                at_least=settings.gas_critical_threshold,
            )
        elif ft == "zone_occupied":
            detail = _worker_detail(context_entries, asset_name)
            if area_owner:
                detail += (
                    f" Area owner: {area_owner.name} ({area_owner.role})."
                )
        elif ft == "permit_conflict":
            detail = _permit_detail(context_entries, asset_name)
        elif ft == "incomplete_isolation":
            detail = _isolation_detail(asset_name)
        elif ft == "simultaneous_ops":
            detail = _simops_detail(asset_name)
        elif ft == "certification_expiring":
            detail = _cert_detail(context_entries, asset_name)
        else:
            detail = f"Derived fact '{ft}' is active on {asset_name}."

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
