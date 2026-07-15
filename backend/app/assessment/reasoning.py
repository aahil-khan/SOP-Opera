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
    "permit_conflict": "Permit conflict",
    "zone_occupied": "Zone occupied",
    "incomplete_isolation": "Incomplete isolation",
    "simultaneous_ops": "Simultaneous operations",
    "certification_expiring": "Certification expiring",
    "over_temperature": "Over temperature",
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


def _gas_detail(
    entries: list[dict[str, Any]], asset_name: str, threshold: float
) -> str:
    for e in entries:
        if e.get("category") != "sensor":
            continue
        payload = e.get("payload") or {}
        reading = payload.get("gas_reading")
        if isinstance(reading, (int, float)):
            unit = payload.get("unit") or "ppm"
            return (
                f"Gas reading {reading} {unit} exceeds the {threshold:g} {unit} "
                f"action threshold on {asset_name}."
            )
    return f"Elevated gas readings exceed the safe working threshold on {asset_name}."


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
    factors: list[ReasoningFactor] = []

    for fact in sorted(facts, key=lambda f: f.fact_type):
        ft = fact.fact_type
        headline = FACT_HEADLINES.get(ft, ft.replace("_", " ").title())
        if ft == "elevated_gas":
            detail = _gas_detail(context_entries, asset_name, threshold)
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
