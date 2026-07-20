"""Single-sensor baseline vs compound fusion detectors."""

from __future__ import annotations

from app.agents.nodes.orchestrator import _fuse_risk
from app.assessment.providers.mock import CRITICAL_SENSOR_FACTS
from app.context.derived_facts import ContextEntryView, evaluate_rules


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
