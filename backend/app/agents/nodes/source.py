"""Source monitoring agents — SCADA, Permit, Maintenance, Workforce."""

from __future__ import annotations

from typing import Any

from app.agents.events import AgentName, make_step
from app.agents.state import AgentObservation, AgentState
from app.agents.tools.rules import RuleToolkit

AGENT_TITLES: dict[str, str] = {
    "scada": "SCADA / Sensor Agent",
    "permit": "Permit / PTW Agent",
    "maintenance": "Maintenance Agent",
    "workforce": "Workforce / Zone Agent",
}

FACT_NARRATION: dict[str, str] = {
    "elevated_gas": "Gas reading exceeds action threshold",
    "over_temperature": "Process temperature above safe band",
    "equipment_vibration_anomaly": "Vibration severity outside ISO band",
    "effluent_quality_breach": "Effluent quality outside discharge limits",
    "tank_level_critical": "Tank level at critical setpoint",
    "weather_hold": "Weather hold criteria breached",
    "permit_conflict": "Overlapping incompatible permits active",
    "simultaneous_ops": "SIMOPS conflict detected",
    "lifting_operation_conflict": "Conflicting lift airspace",
    "incomplete_isolation": "Isolation / LOTO incomplete or unverified",
    "zone_occupied": "Personnel present in hazardous zone",
    "certification_expiring": "Worker certification expiring soon",
    "ppe_noncompliance": "PPE noncompliance in hazard zone",
}


def _local_risk(fact_types: list[str]) -> str:
    if len(fact_types) >= 2:
        return "elevated"
    if fact_types:
        return "elevated"
    return "nominal"


def _toolkit(state: AgentState) -> RuleToolkit:
    return RuleToolkit(
        context_entries=state.get("context_entries") or [],
        known_true_facts=list(state.get("fact_types") or []),
    )


def _run_source_agent(agent: AgentName, state: AgentState) -> dict[str, Any]:
    title = AGENT_TITLES[agent]
    toolkit = _toolkit(state)
    review_id = state.get("review_id")
    assessment_id = state.get("assessment_id")

    started = make_step(
        agent,
        "started",
        f"{title} scanning context for {state.get('asset_name', 'asset')}",
        review_id=review_id,
        assessment_id=assessment_id,
    )

    active = toolkit.active_for_agent(agent)
    tool_steps = []
    for ft in active:
        tool_steps.append(
            make_step(
                agent,
                "tool_call",
                f"Rule tool confirmed: {ft}",
                review_id=review_id,
                assessment_id=assessment_id,
                detail={"fact_type": ft, "active": True},
            ).model_dump()
        )

    if active:
        bits = [FACT_NARRATION.get(ft, ft) for ft in active]
        observation = f"{title}: " + "; ".join(bits) + "."
        finding = "risk"
    else:
        observation = f"{title}: no active hazards in this domain."
        finding = "clearance"

    risk = _local_risk(active)
    obs: AgentObservation = {
        "agent": agent,
        "observation": observation,
        "local_risk": risk,
        "fact_types": active,
        "detail": {"domain": agent, "finding": finding},
    }

    obs_step = make_step(
        agent,
        "observation",
        observation,
        review_id=review_id,
        assessment_id=assessment_id,
        detail={"fact_types": active, "local_risk": risk},
        finding=finding,  # type: ignore[arg-type]
    )
    risk_step = make_step(
        agent,
        "local_risk",
        f"{title} local risk → {risk}",
        review_id=review_id,
        assessment_id=assessment_id,
        detail={"local_risk": risk, "fact_types": active},
    )
    done = make_step(
        agent,
        "completed",
        f"{title} complete",
        review_id=review_id,
        assessment_id=assessment_id,
    )

    return {
        "observations": [obs],
        "agent_trace": [
            started.model_dump(),
            *tool_steps,
            obs_step.model_dump(),
            risk_step.model_dump(),
            done.model_dump(),
        ],
    }


async def scada_agent(state: AgentState) -> dict[str, Any]:
    return _run_source_agent("scada", state)


async def permit_agent(state: AgentState) -> dict[str, Any]:
    return _run_source_agent("permit", state)


async def maintenance_agent(state: AgentState) -> dict[str, Any]:
    return _run_source_agent("maintenance", state)


async def workforce_agent(state: AgentState) -> dict[str, Any]:
    return _run_source_agent("workforce", state)
