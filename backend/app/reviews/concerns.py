"""Supervisor floor-report concern types and derived-fact mapping."""

from __future__ import annotations

from typing import Literal

SupervisorConcernType = Literal[
    "safety_hazard",
    "equipment",
    "permit_isolation",
    "environmental",
    "personnel",
    "other",
]

SUPERVISOR_CONCERN_TYPES: frozenset[str] = frozenset(
    {
        "safety_hazard",
        "equipment",
        "permit_isolation",
        "environmental",
        "personnel",
        "other",
    }
)

CONCERN_TO_FACT: dict[str, str] = {
    "safety_hazard": "supervisor_safety_hazard",
    "equipment": "supervisor_equipment_issue",
    "permit_isolation": "supervisor_permit_issue",
    "environmental": "supervisor_environmental_issue",
    "personnel": "supervisor_personnel_issue",
    "other": "supervisor_floor_report",
}

SUPERVISOR_FACT_TYPES: frozenset[str] = frozenset(CONCERN_TO_FACT.values())

BLOCKING_SUPERVISOR_FACTS: frozenset[str] = frozenset({"supervisor_safety_hazard"})


def normalize_concern_type(raw: str | None) -> str:
    if raw in SUPERVISOR_CONCERN_TYPES:
        return raw
    return "other"


def fact_type_for_concern(concern_type: str) -> str:
    return CONCERN_TO_FACT.get(concern_type, "supervisor_floor_report")
