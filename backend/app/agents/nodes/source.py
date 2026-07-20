"""Source monitoring agents — SCADA, Permit, Maintenance, Workforce."""

from __future__ import annotations

from typing import Any

from app.agents.events import AgentName, make_step
from app.agents.llm import get_chat_model, usage_record
from app.agents.llm_outcomes import make_outcome, short_error
from app.agents.routing import AGENT_CONTEXT_CATEGORIES
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
    "critical_gas": "CRITICAL — gas crossed incident threshold",
    "over_temperature": "Process temperature above safe band",
    "critical_temperature": "CRITICAL — temperature crossed incident threshold",
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
    if any(ft in ("critical_gas", "critical_temperature") for ft in fact_types):
        return "blocking"
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


def _template_observation(title: str, active: list[str]) -> str:
    bits = [FACT_NARRATION.get(ft, ft) for ft in active]
    return f"{title}: " + "; ".join(bits) + "."


def _context_slice_for_agent(
    agent: str, state: AgentState, *, limit: int = 6
) -> list[dict[str, Any]]:
    cats = AGENT_CONTEXT_CATEGORIES.get(agent, frozenset())
    out: list[dict[str, Any]] = []
    for e in state.get("context_entries") or []:
        if e.get("category") not in cats:
            continue
        payload = e.get("payload") or {}
        slim = {
            k: v
            for k, v in list(payload.items())[:8]
            if isinstance(v, (str, int, float, bool)) or v is None
        }
        out.append({"category": e.get("category"), "payload": slim})
        if len(out) >= limit:
            break
    return out


def _build_narration_prompt(
    *,
    title: str,
    asset: str,
    active: list[str],
    context_slice: list[dict[str, Any]],
) -> str:
    anchors = [f"- {ft}: {FACT_NARRATION.get(ft, ft)}" for ft in active]
    return (
        f"You are the {title} for an industrial plant digital twin.\n"
        f"Write 1-2 sentences observing hazards on asset '{asset}'. "
        "Do not invent facts, readings, or permits not listed below. "
        "Do not mention being an AI.\n\n"
        f"Confirmed facts:\n" + "\n".join(anchors) + "\n\n"
        f"Relevant context (category-filtered):\n{context_slice}\n"
    )


async def _narrate_observation(
    agent: AgentName,
    title: str,
    state: AgentState,
    active: list[str],
) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None]:
    """LLM narration when available; template fallback otherwise.

    Returns (observation_text, usage_record_or_none, llm_outcome_or_none).
    Mock mode skips LLM entirely (outcome None).
    """
    template = _template_observation(title, active)
    provider_name = state.get("provider_name")
    model = get_chat_model(provider_name)
    if model is None:
        return template, None, None
    prompt = _build_narration_prompt(
        title=title,
        asset=str(state.get("asset_name") or "asset"),
        active=active,
        context_slice=_context_slice_for_agent(agent, state),
    )
    try:
        result = await model.ainvoke(prompt)
        usage = usage_record(
            agent=agent, response=result, provider_name=provider_name
        )
        content = getattr(result, "content", None)
        if isinstance(content, str) and content.strip():
            text = content.strip()
            # Keep agent identity prefix for the Brain panel when the model omits it
            if title.split()[0].lower() not in text.lower()[:40]:
                text = f"{title}: {text}"
            return text, usage, make_outcome(agent, "ok")
        return (
            template,
            usage,
            make_outcome(agent, "fallback", reason="empty_response"),
        )
    except Exception as exc:  # noqa: BLE001
        return (
            template,
            None,
            make_outcome(agent, "fallback", reason=short_error(exc)),
        )


async def _run_source_agent(agent: AgentName, state: AgentState) -> dict[str, Any]:
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

    usage_entries: list[dict[str, Any]] = []
    llm_outcomes: list[dict[str, Any]] = []
    fallback_steps: list[dict[str, Any]] = []
    if active:
        observation, usage, outcome = await _narrate_observation(
            agent, title, state, active
        )
        if usage is not None:
            usage_entries.append(usage)
        if outcome is not None:
            llm_outcomes.append(outcome)
            if outcome.get("status") == "fallback":
                fallback_steps.append(
                    make_step(
                        agent,
                        "error",
                        (
                            "LLM narration unavailable — using template "
                            f"({outcome.get('reason', 'unknown')})"
                        ),
                        review_id=review_id,
                        assessment_id=assessment_id,
                        detail={
                            **outcome,
                            "narration_mode": "template_fallback",
                        },
                    ).model_dump()
                )
        finding = "risk"
    else:
        # Clearance: no LLM — keep cheap template
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

    out: dict[str, Any] = {
        "observations": [obs],
        "agent_trace": [
            started.model_dump(),
            *tool_steps,
            *fallback_steps,
            obs_step.model_dump(),
            risk_step.model_dump(),
            done.model_dump(),
        ],
    }
    if usage_entries:
        out["llm_usage"] = usage_entries
    if llm_outcomes:
        out["llm_outcomes"] = llm_outcomes
    return out


async def scada_agent(state: AgentState) -> dict[str, Any]:
    return await _run_source_agent("scada", state)


async def permit_agent(state: AgentState) -> dict[str, Any]:
    return await _run_source_agent("permit", state)


async def maintenance_agent(state: AgentState) -> dict[str, Any]:
    return await _run_source_agent("maintenance", state)


async def workforce_agent(state: AgentState) -> dict[str, Any]:
    return await _run_source_agent("workforce", state)
