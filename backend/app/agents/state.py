"""Shared LangGraph AgentState for the compound-risk brain."""

from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


class AgentObservation(TypedDict):
    agent: str
    observation: str
    local_risk: str  # nominal | elevated | blocking
    fact_types: list[str]
    detail: dict[str, Any]


class AgentState(TypedDict):
    review_id: str
    assessment_id: str
    asset_id: str
    asset_name: str
    asset_zone: str
    # Pre-computed true derived facts from DB (ground truth)
    fact_types: list[str]
    facts: list[dict[str, Any]]
    context_entries: list[dict[str, Any]]
    # Plant-wide (or neighborhood) context for spatial correlation
    plant_context_entries: list[dict[str, Any]]
    retrieved_references: list[dict[str, Any]]
    # Parallel source agents append observations
    observations: Annotated[list[AgentObservation], operator.add]
    # Streamed steps (also broadcast via WS during run)
    agent_trace: Annotated[list[dict[str, Any]], operator.add]
    # Spatial Agent findings
    spatial_links: list[dict[str, Any]]
    # Incident Pattern Agent echoes
    incident_echoes: list[dict[str, Any]]
    # Shift handover note from in-graph agent
    shift_handover_note: str | None
    # Final structured assessment (orchestrator fills)
    verdict: dict[str, Any] | None
    grounded_fact_types: list[str]  # rule-tool confirmed facts used for BLOCK
