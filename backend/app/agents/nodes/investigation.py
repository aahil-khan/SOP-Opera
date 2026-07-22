"""Investigation Narrative Agent — verdict-safe generative enrichment.

Runs *after* the orchestrator has frozen the verdict. It reads the already-decided
verdict, grounded facts, retrieved references and incident echoes, and generates a
short investigation / conditions-to-verify advisory for the supervisor.

It is structurally incapable of changing the verdict: it returns only
`observations` / `agent_trace` (+ optional `llm_usage` / `llm_outcomes`), never
`verdict`, `risk_level`, `grounded_fact_types`, or `recommendations`. See
`app/agents/graph.py` — the astream merge only extends those keys, so nothing this
node emits can overwrite the risk lattice. `risk_policy.classify()` remains the sole
writer of `risk_level`.
"""

from __future__ import annotations

from typing import Any

from app.agents.events import make_step
from app.agents.llm import get_chat_model, usage_record
from app.agents.llm_outcomes import make_outcome, short_error
from app.agents.state import AgentObservation, AgentState

_FACT_CONDITION: dict[str, str] = {
    "elevated_gas": "re-verify the atmosphere with a fresh gas test and confirm ventilation",
    "critical_gas": "evacuate and re-test the atmosphere before any re-entry",
    "over_temperature": "confirm the process is within its safe temperature band",
    "critical_temperature": "hold work until the temperature returns below the incident line",
    "equipment_vibration_anomaly": "inspect the affected rotating equipment before restart",
    "incomplete_isolation": "confirm and independently witness LOTO / isolation",
    "permit_conflict": "reconcile the overlapping permits before either proceeds",
    "simultaneous_ops": "separate the incompatible operations in time or space",
    "lifting_operation_conflict": "de-conflict the lift airspace before lifting",
    "zone_occupied": "clear and account for all personnel in the hazardous zone",
    "certification_expiring": "reassign or re-certify the affected worker",
    "ppe_noncompliance": "restore PPE compliance before entry",
    "weather_hold": "wait for weather-hold criteria to clear",
}


def _conditions(grounded: list[str]) -> list[str]:
    seen: list[str] = []
    for ft in grounded:
        cond = _FACT_CONDITION.get(ft)
        if cond and cond not in seen:
            seen.append(cond)
    return seen


def _incident_headline(state: AgentState) -> str | None:
    for echo in state.get("incident_echoes") or []:
        title = echo.get("title")
        if title:
            return str(title)
    for r in state.get("retrieved_references") or []:
        if r.get("source") in ("historical_incidents", "incidents") and r.get("title"):
            return str(r.get("title"))
    return None


def _template_narrative(state: AgentState, verdict: dict[str, Any]) -> str:
    risk = str(verdict.get("risk_level") or "nominal")
    grounded = list(state.get("grounded_fact_types") or [])
    asset = str(state.get("asset_name") or "this asset")
    conditions = _conditions(grounded)
    if risk == "nominal" or not conditions:
        return (
            f"No re-work conditions required for {asset}; continue routine monitoring."
        )
    if len(conditions) == 1:
        cond_text = conditions[0]
    else:
        cond_text = "; ".join(conditions[:-1]) + f"; and {conditions[-1]}"
    lead = "Before this work can safely proceed" if risk == "blocking" else "To keep this work within limits"
    line = f"{lead} on {asset}: {cond_text}."
    headline = _incident_headline(state)
    if headline:
        line = f"{line} This mirrors {headline}, so treat the conditions as mandatory, not advisory."
    return line


def _build_prompt(state: AgentState, verdict: dict[str, Any]) -> str:
    grounded = list(state.get("grounded_fact_types") or [])
    conditions = _conditions(grounded)
    headline = _incident_headline(state)
    incident_line = (
        f"Matching prior near-miss (for framing only): {headline}\n" if headline else ""
    )
    return (
        "You are an industrial safety investigator writing for a shift supervisor.\n"
        f"The verdict for asset '{state.get('asset_name')}' is already decided: "
        f"{verdict.get('risk_level')}. Do NOT re-decide it, soften it, or argue with it.\n"
        "Write 2-3 plain sentences stating the concrete conditions that must be "
        "verified before this work can safely proceed. Ground every condition in the "
        "facts and suggested checks below — invent nothing.\n"
        "Do not mention being an AI. Write for a supervisor named Rajesh, not a data scientist.\n\n"
        f"Grounded facts: {grounded}\n"
        f"Suggested checks: {conditions}\n"
        f"{incident_line}"
    )


async def investigation_agent(state: AgentState) -> dict[str, Any]:
    review_id = state.get("review_id")
    assessment_id = state.get("assessment_id")
    verdict = state.get("verdict") or {}
    risk = str(verdict.get("risk_level") or "nominal")

    started = make_step(
        "investigation",
        "started",
        "Investigation Agent drafting the conditions to verify before work proceeds",
        review_id=review_id,
        assessment_id=assessment_id,
        detail={"risk_level": risk},
    )

    template = _template_narrative(state, verdict)
    provider_name = state.get("provider_name")
    model = get_chat_model(provider_name)

    narrative = template
    usage: dict[str, Any] | None = None
    outcome: dict[str, Any] | None = None
    if model is not None:
        try:
            result = await model.ainvoke(_build_prompt(state, verdict))
            usage = usage_record(
                agent="investigation", response=result, provider_name=provider_name
            )
            content = getattr(result, "content", None)
            if isinstance(content, str) and content.strip():
                narrative = content.strip()
                outcome = make_outcome("investigation", "ok")
            else:
                outcome = make_outcome(
                    "investigation", "fallback", reason="empty_response"
                )
        except Exception as exc:  # noqa: BLE001
            outcome = make_outcome(
                "investigation", "fallback", reason=short_error(exc)
            )

    finding = "risk" if risk in ("elevated", "blocking") else "neutral"
    obs: AgentObservation = {
        "agent": "investigation",
        "observation": narrative,
        "local_risk": "nominal",  # advisory only — never escalates the verdict
        "fact_types": [],
        "detail": {"finding": finding, "advisory": True, "risk_level": risk},
    }

    steps = [
        started.model_dump(),
        make_step(
            "investigation",
            "observation",
            narrative,
            review_id=review_id,
            assessment_id=assessment_id,
            detail={"advisory": True, "risk_level": risk},
            finding=finding,  # type: ignore[arg-type]
        ).model_dump(),
        make_step(
            "investigation",
            "completed",
            "Investigation Agent complete",
            review_id=review_id,
            assessment_id=assessment_id,
        ).model_dump(),
    ]

    out: dict[str, Any] = {"observations": [obs], "agent_trace": steps}
    if usage is not None:
        out["llm_usage"] = [usage]
    if outcome is not None:
        out["llm_outcomes"] = [outcome]
    return out
