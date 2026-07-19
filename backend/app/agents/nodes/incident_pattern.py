"""Incident Pattern Agent — RAG / seeded echo of prior near-misses."""

from __future__ import annotations

from typing import Any

from app.agents.events import make_step
from app.agents.state import AgentObservation, AgentState

# Offline / mock fallbacks when retrieval refs are empty (still demo-visible)
FACT_PATTERN_ECHO: dict[str, dict[str, Any]] = {
    "elevated_gas": {
        "title": "VSP-pattern near-miss (gas + work authorization)",
        "snippet": (
            "Elevated CO on coke oven battery coincided with active hot-work permit — "
            "pattern echoed in Visakhapatnam Steel Plant 2025 investigations."
        ),
        "retrieval_path": "deterministic",
        "score": 0.91,
        "triggered_by_fact": "elevated_gas",
    },
    "zone_occupied": {
        "title": "Near-miss: workers in zone during gas alarm",
        "snippet": (
            "Workers remained in hazardous zone during gas alarm; "
            "alarm was ignored for 4 minutes."
        ),
        "retrieval_path": "deterministic",
        "score": 0.88,
        "triggered_by_fact": "zone_occupied",
    },
    "permit_conflict": {
        "title": "Overlapping permits preceded SIMOPS near-miss",
        "snippet": (
            "Conflicting permits on the same asset preceded an uncontrolled "
            "interaction between work parties."
        ),
        "retrieval_path": "deterministic",
        "score": 0.84,
        "triggered_by_fact": "permit_conflict",
    },
    "simultaneous_ops": {
        "title": "Hot work + lift SIMOPS incident",
        "snippet": (
            "Simultaneous crane lift and hot work caused sparks to enter a live process area."
        ),
        "retrieval_path": "deterministic",
        "score": 0.86,
        "triggered_by_fact": "simultaneous_ops",
    },
}


def _incident_refs(state: AgentState) -> list[dict[str, Any]]:
    refs = []
    for r in state.get("retrieved_references") or []:
        src = r.get("source")
        if src in ("historical_incidents", "incidents"):
            refs.append(r)
    return refs


def _fallback_echoes(fact_types: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ft in fact_types:
        echo = FACT_PATTERN_ECHO.get(ft)
        if echo:
            out.append(dict(echo))
    return out


async def incident_pattern_agent(state: AgentState) -> dict[str, Any]:
    review_id = state.get("review_id")
    assessment_id = state.get("assessment_id")
    fact_types = list(state.get("fact_types") or [])

    started = make_step(
        "incident_pattern",
        "started",
        "Incident Pattern Agent searching historical near-miss corpus",
        review_id=review_id,
        assessment_id=assessment_id,
        detail={"fact_types": fact_types},
    )

    refs = _incident_refs(state)
    path_note = "rag" if any(r.get("retrieval_path") == "rag" for r in refs) else None
    if not refs:
        refs = _fallback_echoes(fact_types)
        path_note = "deterministic_fallback"

    tool = make_step(
        "incident_pattern",
        "tool_call",
        (
            f"Retrieved {len(refs)} incident pattern(s)"
            + (f" via {path_note}" if path_note else "")
        ),
        review_id=review_id,
        assessment_id=assessment_id,
        detail={
            "count": len(refs),
            "path": path_note,
            "refs": [
                {
                    "id": r.get("id"),
                    "title": r.get("title"),
                    "snippet": r.get("snippet"),
                    "score": r.get("score"),
                    "retrieval_path": r.get("retrieval_path") or path_note,
                    "triggered_by_fact": r.get("triggered_by_fact"),
                }
                for r in refs[:5]
            ],
        },
    )

    if refs:
        top = refs[0]
        title = top.get("title") or "prior near-miss"
        snippet = top.get("snippet") or ""
        score = top.get("score")
        path = top.get("retrieval_path") or path_note or "unknown"
        score_bit = f", score={score:.2f}" if isinstance(score, (int, float)) else ""
        observation = (
            f"Incident Pattern Agent: current conditions echo '{title}' "
            f"(path={path}{score_bit}). {snippet}"
        ).strip()
        risk = "elevated"
        if len(fact_types) >= 2 or any(
            ft in fact_types
            for ft in ("elevated_gas", "zone_occupied", "permit_conflict")
        ):
            risk = "elevated"
    else:
        observation = (
            "Incident Pattern Agent: no matching historical near-miss for active facts."
        )
        risk = "nominal"

    obs: AgentObservation = {
        "agent": "incident_pattern",
        "observation": observation,
        "local_risk": risk,
        "fact_types": [],
        "detail": {"incident_echoes": refs[:5], "retrieval_path": path_note},
    }

    steps = [
        started.model_dump(),
        tool.model_dump(),
        make_step(
            "incident_pattern",
            "observation",
            observation,
            review_id=review_id,
            assessment_id=assessment_id,
            detail=obs["detail"],
        ).model_dump(),
        make_step(
            "incident_pattern",
            "local_risk",
            f"Incident Pattern Agent local risk → {risk}",
            review_id=review_id,
            assessment_id=assessment_id,
            detail={"local_risk": risk},
        ).model_dump(),
        make_step(
            "incident_pattern",
            "completed",
            "Incident Pattern Agent complete",
            review_id=review_id,
            assessment_id=assessment_id,
        ).model_dump(),
    ]

    return {
        "observations": [obs],
        "agent_trace": steps,
        "incident_echoes": refs[:5],
    }
