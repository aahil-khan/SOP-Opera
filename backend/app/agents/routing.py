"""Context/risk gates for selective LangGraph agent fan-out."""

from __future__ import annotations

from typing import Any

from app.agents.tools.rules import RuleToolkit
from app.core.config import get_settings

SOURCE_AGENTS: tuple[str, ...] = ("scada", "permit", "maintenance", "workforce")

AGENT_CONTEXT_CATEGORIES: dict[str, frozenset[str]] = {
    "scada": frozenset({"sensor", "weather"}),
    "permit": frozenset({"permit", "lift_plan"}),
    "maintenance": frozenset({"isolation_status"}),
    "workforce": frozenset({"worker_location", "certification", "ppe_status"}),
}

# Facts that warrant spatial neighborhood load / KG correlation pre-graph
SPATIAL_TRIGGER_FACTS: frozenset[str] = frozenset(
    {
        "elevated_gas",
        "permit_conflict",
        "simultaneous_ops",
        "lifting_operation_conflict",
        "zone_occupied",
    }
)


def select_source_agents(state: dict[str, Any]) -> list[str]:
    """Return source agents that have matching facts or context categories."""
    toolkit = RuleToolkit(
        context_entries=state.get("context_entries") or [],
        known_true_facts=list(state.get("fact_types") or []),
    )
    categories = {
        e.get("category")
        for e in (state.get("context_entries") or [])
        if e.get("category")
    }
    selected: list[str] = []
    for agent in SOURCE_AGENTS:
        if toolkit.active_for_agent(agent):
            selected.append(agent)
            continue
        owned_cats = AGENT_CONTEXT_CATEGORIES.get(agent, frozenset())
        if categories & owned_cats:
            selected.append(agent)
    return selected


def _gas_threshold() -> float:
    return float(get_settings().gas_elevated_threshold)


def has_gas_or_hot_work_signals(
    *,
    fact_types: list[str] | None = None,
    context_entries: list[dict[str, Any]] | None = None,
    plant_context_entries: list[dict[str, Any]] | None = None,
    gas_threshold: float | None = None,
) -> bool:
    """True when elevated gas facts/readings or active hot-work permits exist."""
    facts = set(fact_types or [])
    if "elevated_gas" in facts:
        return True

    threshold = (
        float(gas_threshold) if gas_threshold is not None else _gas_threshold()
    )
    entries = list(context_entries or []) + list(plant_context_entries or [])
    for e in entries:
        cat = e.get("category")
        payload = e.get("payload") or {}
        if cat == "sensor":
            reading = payload.get("gas_reading")
            if isinstance(reading, (int, float)) and float(reading) > threshold:
                return True
        if cat == "permit":
            if (
                payload.get("status") == "active"
                and payload.get("work_type") == "hot_work"
            ):
                return True
    return False


def should_run_spatial(state: dict[str, Any]) -> bool:
    """Run spatial after sources when any domain is elevated or gas/hot-work is present."""
    for o in state.get("observations") or []:
        if o.get("local_risk") in ("elevated", "blocking"):
            return True
    return has_gas_or_hot_work_signals(
        fact_types=list(state.get("fact_types") or []),
        context_entries=list(state.get("context_entries") or []),
        plant_context_entries=list(state.get("plant_context_entries") or []),
    )


def should_run_predictive_trend(state: dict[str, Any]) -> bool:
    """Run trend projection when sensor telemetry exists for the focus asset."""
    asset_id = str(state.get("asset_id") or "")
    entries = list(state.get("context_entries") or [])
    for e in entries:
        if e.get("category") != "sensor":
            continue
        if asset_id and str(e.get("asset_id") or "") != asset_id:
            continue
        payload = e.get("payload") or {}
        if any(
            isinstance(payload.get(k), (int, float))
            for k in ("gas_reading", "temp_reading", "vibration_mm_s")
        ):
            return True
    return False


def should_run_enrichment(state: dict[str, Any]) -> bool:
    """Run incident pattern only when the orchestrator verdict is elevated or blocking."""
    verdict = state.get("verdict") or {}
    return verdict.get("risk_level") in ("elevated", "blocking")


def should_run_shift_handover(state: dict[str, Any]) -> bool:
    """
    Run the handover check only when this asset actually carried something.

    Unlike the other analysis agents this gate reads preloaded DB rows rather
    than facts, because the question — did the incoming operator ever read this
    hazard — has no answer in the telemetry. The node runs pre-verdict, so an
    empty carry-forward must skip it rather than emit a nominal observation the
    orchestrator would then have to narrate.
    """
    return bool(state.get("carried_handover_items"))


def should_load_plant_neighborhood(
    fact_types: list[str],
    context_entries: list[dict[str, Any]] | None = None,
) -> bool:
    """Skip neighborhood DB/KG load when spatial correlation cannot fire."""
    if set(fact_types) & SPATIAL_TRIGGER_FACTS:
        return True
    return has_gas_or_hot_work_signals(
        fact_types=fact_types,
        context_entries=context_entries or [],
    )


__all__ = [
    "AGENT_CONTEXT_CATEGORIES",
    "SOURCE_AGENTS",
    "SPATIAL_TRIGGER_FACTS",
    "has_gas_or_hot_work_signals",
    "select_source_agents",
    "should_load_plant_neighborhood",
    "should_run_enrichment",
    "should_run_predictive_trend",
    "should_run_shift_handover",
    "should_run_spatial",
]
