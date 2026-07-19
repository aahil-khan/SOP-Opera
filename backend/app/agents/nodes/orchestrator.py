"""Orchestrator agent — fuses source observations into a grounded assessment."""

from __future__ import annotations

from typing import Any

from shared.python.schemas import RecommendationIn

from app.agents.events import make_step
from app.agents.llm import get_chat_model, model_label, provider_label
from app.agents.state import AgentState
from app.agents.tools.rules import RuleToolkit, require_grounding_for_block
from app.assessment.providers.mock import COMPOUND_TRIO, FACT_RECOMMENDATIONS
from app.assessment.schemas import AssessmentResult
from app.core.config import get_settings


def _fuse_risk(grounded: list[str], observations: list[dict[str, Any]]) -> str:
    grounded_set = set(grounded)
    # Drop non-rule spatial marker from grounding set for trio checks
    rule_facts = grounded_set - {"spatial_cooccurrence"}
    spatial_hit = any(
        o.get("agent") == "spatial" and o.get("local_risk") in ("elevated", "blocking")
        for o in observations
    )
    if COMPOUND_TRIO.issubset(rule_facts) or len(rule_facts) >= 3:
        return "blocking"
    # Spatial hot-work near gas + at least one grounded process/people fact → block
    if spatial_hit and (
        "elevated_gas" in rule_facts
        or "zone_occupied" in rule_facts
        or "permit_conflict" in rule_facts
        or any(ft.startswith("elevated") or ft == "incomplete_isolation" for ft in rule_facts)
    ):
        return "blocking"
    if any(o.get("local_risk") == "blocking" for o in observations):
        # Spatial-only blocking still needs grounding via require_grounding_for_block
        if spatial_hit and not rule_facts:
            return "elevated"
        return "blocking"
    if rule_facts or any(o.get("local_risk") == "elevated" for o in observations):
        return "elevated"
    return "nominal"


def _recommendations(
    grounded: list[str], observations: list[dict[str, Any]]
) -> list[RecommendationIn]:
    recs: list[RecommendationIn] = []
    for ft in sorted(f for f in grounded if f != "spatial_cooccurrence"):
        text, rationale = FACT_RECOMMENDATIONS.get(
            ft,
            (
                f"Review and mitigate derived fact '{ft}'.",
                f"Fact '{ft}' is active and requires supervisor action.",
            ),
        )
        recs.append(RecommendationIn(text=text, rationale=rationale))
    spatial = next((o for o in observations if o.get("agent") == "spatial"), None)
    links = (spatial or {}).get("detail", {}).get("spatial_links") or []
    if links:
        first = links[0]
        recs.insert(
            0,
            RecommendationIn(
                text=(
                    "Suspend hot work within the spatial radius of the gas event "
                    "and re-verify atmosphere before restart."
                ),
                rationale=str(first.get("reason") or "Spatial co-occurrence detected."),
            ),
        )
    if not recs:
        recs.append(
            RecommendationIn(
                text="Continue routine monitoring; no elevated facts detected.",
                rationale="No active derived facts at assessment time.",
            )
        )
    return recs


def _mock_summary(
    state: AgentState,
    grounded: list[str],
    risk: str,
    observations: list[dict[str, Any]],
) -> str:
    agent_bits = [
        f"[{o.get('agent')}] {o.get('observation')}" for o in observations
    ]
    facts_list = ", ".join(grounded) or "none"
    refs = state.get("retrieved_references") or []
    ref_bits = (
        ", ".join(sorted({f"{r.get('source')}:{r.get('id')}" for r in refs}))
        if refs
        else "none"
    )
    incident_obs = next(
        (o.get("observation") for o in observations if o.get("agent") == "incident_pattern"),
        None,
    )
    summary = (
        f"Multi-agent assessment for {state.get('asset_name')} "
        f"({state.get('asset_zone')}). "
        f"Grounded facts [{facts_list}]. Risk={risk}. "
        f"Agents: {' | '.join(agent_bits)}. "
        f"Retrieved references: {ref_bits}."
    )
    if incident_obs and "echo" in incident_obs.lower():
        summary += f" {incident_obs}"
    return summary



async def _llm_summary(
    state: AgentState,
    grounded: list[str],
    risk: str,
    observations: list[dict[str, Any]],
    provider_name: str | None,
) -> str | None:
    model = get_chat_model(provider_name)
    if model is None:
        return None
    try:
        prompt = (
            "You are an industrial safety orchestrator. "
            "Synthesize the agent observations into a concise operational assessment "
            "(3-5 sentences). Do not invent facts not listed.\n\n"
            f"Asset: {state.get('asset_name')} zone={state.get('asset_zone')}\n"
            f"Grounded facts: {grounded}\n"
            f"Fused risk: {risk}\n"
            f"Observations:\n"
            + "\n".join(
                f"- {o.get('agent')}: {o.get('observation')}" for o in observations
            )
        )
        result = await model.ainvoke(prompt)
        content = getattr(result, "content", None)
        if isinstance(content, str) and content.strip():
            return content.strip()
    except Exception:  # noqa: BLE001
        return None
    return None


async def orchestrator_agent(
    state: AgentState, *, provider_name: str | None = None
) -> dict[str, Any]:
    review_id = state.get("review_id")
    assessment_id = state.get("assessment_id")
    observations = list(state.get("observations") or [])

    started = make_step(
        "orchestrator",
        "started",
        "Orchestrator fusing agent signals into compound risk verdict",
        review_id=review_id,
        assessment_id=assessment_id,
        detail={"observation_count": len(observations)},
    )

    toolkit = RuleToolkit(
        context_entries=state.get("context_entries") or [],
        known_true_facts=list(state.get("fact_types") or []),
    )
    grounded = toolkit.all_active()
    reported = sorted(
        {ft for o in observations for ft in (o.get("fact_types") or [])}
    )
    grounded = sorted(
        {
            ft
            for ft in (set(grounded) | set(reported) | set(state.get("fact_types") or []))
            if ft != "spatial_cooccurrence"
        }
    )

    proposed = _fuse_risk(grounded, observations)
    risk = require_grounding_for_block(proposed, grounded)

    settings = get_settings()
    pname = provider_name or settings.ai_provider
    summary = await _llm_summary(state, grounded, risk, observations, pname)
    if summary is None:
        summary = _mock_summary(state, grounded, risk, observations)

    recs = _recommendations(grounded, observations)
    result = AssessmentResult(
        summary=summary,
        risk_level=risk,  # type: ignore[arg-type]
        recommendations=recs,
        confidence=0.92 if grounded else 0.7,
    )

    spatial_links = list(state.get("spatial_links") or [])
    for o in observations:
        if o.get("agent") == "spatial":
            spatial_links = list(o.get("detail", {}).get("spatial_links") or spatial_links)

    verdict_step = make_step(
        "orchestrator",
        "verdict",
        f"Compound verdict → {risk} (grounded facts: {', '.join(grounded) or 'none'})",
        review_id=review_id,
        assessment_id=assessment_id,
        detail={
            "risk_level": risk,
            "grounded_fact_types": grounded,
            "proposed_risk": proposed,
            "spatial_links": spatial_links,
            "provider": provider_label(pname),
            "model": model_label(pname),
        },
    )
    done = make_step(
        "orchestrator",
        "completed",
        "Orchestrator assessment complete",
        review_id=review_id,
        assessment_id=assessment_id,
    )

    return {
        "verdict": result.model_dump(),
        "grounded_fact_types": grounded,
        "spatial_links": spatial_links,
        "agent_trace": [
            started.model_dump(),
            verdict_step.model_dump(),
            done.model_dump(),
        ],
    }
