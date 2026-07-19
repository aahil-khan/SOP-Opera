"""Orchestrator agent — fuses source observations into a grounded assessment."""

from __future__ import annotations

from typing import Any

from shared.python.schemas import RecommendationIn

from app.agents.events import make_step
from app.agents.llm import get_chat_model, model_label, provider_label, usage_record
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


def _pick_citation_refs(
    refs: list[dict[str, Any]], *, limit: int = 2
) -> list[dict[str, Any]]:
    """Prefer one historical incident then one regulation/SOP (max `limit`)."""
    picked: list[dict[str, Any]] = []
    incidents = [
        r
        for r in refs
        if r.get("source") in ("historical_incidents", "incidents")
        and (r.get("title") or r.get("snippet") or r.get("code"))
    ]
    standards = [
        r
        for r in refs
        if r.get("source") in ("regulations", "sops")
        and (r.get("title") or r.get("snippet") or r.get("code"))
    ]
    if incidents:
        picked.append(incidents[0])
    if standards and len(picked) < limit:
        picked.append(standards[0])
    # Fill remaining from leftover if still short
    if len(picked) < limit:
        for r in refs:
            if r in picked:
                continue
            if r.get("title") or r.get("snippet") or r.get("code"):
                picked.append(r)
            if len(picked) >= limit:
                break
    return picked[:limit]


def _format_ref_line(r: dict[str, Any]) -> str:
    label = r.get("code") or r.get("title") or "untitled"
    snippet = str(r.get("snippet") or "").strip()
    if len(snippet) > 200:
        snippet = snippet[:197].rstrip() + "…"
    bits = [str(r.get("source") or "ref"), str(label)]
    if snippet:
        bits.append(snippet)
    return " | ".join(bits)


def _build_summary_prompt(
    state: AgentState,
    grounded: list[str],
    risk: str,
    observations: list[dict[str, Any]],
) -> str:
    """Compose orch LLM prompt: fuse domain narratives; cite retrieved refs."""
    obs_lines = "\n".join(
        f"- {o.get('agent')}: {o.get('observation')}" for o in observations
    )
    citations = _pick_citation_refs(list(state.get("retrieved_references") or []))
    if citations:
        ref_block = "Retrieved context (cite by title/code only if relevant):\n" + "\n".join(
            f"- {_format_ref_line(r)}" for r in citations
        )
    else:
        ref_block = "Retrieved context: (none)"

    return (
        "You are an industrial safety orchestrator.\n"
        "Domain observations below are already domain-specific narratives — "
        "synthesize the compound risk in 3-5 sentences. "
        "Do not paste domain observations back verbatim. "
        "Cite at most the retrieved titles/codes when relevant; "
        "never invent references or facts not listed.\n\n"
        f"Asset: {state.get('asset_name')} zone={state.get('asset_zone')}\n"
        f"Grounded facts: {grounded}\n"
        f"Fused risk: {risk}\n"
        f"Observations:\n{obs_lines}\n\n"
        f"{ref_block}\n"
    )


def _mock_summary(
    state: AgentState,
    grounded: list[str],
    risk: str,
    observations: list[dict[str, Any]],
) -> str:
    asset = state.get("asset_name") or "Asset"
    fact_labels = [ft.replace("_", " ") for ft in grounded]
    if fact_labels:
        if len(fact_labels) == 1:
            cause = fact_labels[0]
        elif len(fact_labels) == 2:
            cause = f"{fact_labels[0]} and {fact_labels[1]}"
        else:
            cause = (
                f"{', '.join(fact_labels[:-1])}, and {fact_labels[-1]}"
            )
        lead = f"{asset} is {risk} due to {cause}."
    else:
        lead = f"{asset} assessment completed with {risk} risk."

    highlights: list[str] = []
    for o in observations:
        agent = str(o.get("agent") or "")
        if agent in ("", "orchestrator"):
            continue
        obs = str(o.get("observation") or "").strip()
        if not obs:
            continue
        # Keep each agent note short for the panel.
        if len(obs) > 140:
            obs = obs[:137].rstrip() + "…"
        label = {
            "scada": "SCADA",
            "permit": "Permit",
            "maintenance": "Maintenance",
            "workforce": "Workforce",
            "spatial": "Spatial",
            "incident_pattern": "Incident",
            "shift_handover": "Handover",
        }.get(agent, agent.replace("_", " ").title())
        highlights.append(f"{label}: {obs}")

    body = lead if not highlights else lead + " " + " ".join(highlights[:4])

    citations = _pick_citation_refs(list(state.get("retrieved_references") or []))
    incident = next(
        (
            r
            for r in citations
            if r.get("source") in ("historical_incidents", "incidents") and r.get("title")
        ),
        None,
    )
    if incident and incident.get("title"):
        body = f"{body} Related pattern: {incident['title']}."
    return body


async def _llm_summary(
    state: AgentState,
    grounded: list[str],
    risk: str,
    observations: list[dict[str, Any]],
    provider_name: str | None,
) -> tuple[str | None, dict[str, Any] | None]:
    model = get_chat_model(provider_name)
    if model is None:
        return None, None
    try:
        prompt = _build_summary_prompt(state, grounded, risk, observations)
        result = await model.ainvoke(prompt)
        usage = usage_record(
            agent="orchestrator", response=result, provider_name=provider_name
        )
        content = getattr(result, "content", None)
        if isinstance(content, str) and content.strip():
            return content.strip(), usage
        return None, usage
    except Exception:  # noqa: BLE001
        return None, None


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
    pname = provider_name or state.get("provider_name") or settings.ai_provider
    summary, orch_usage = await _llm_summary(
        state, grounded, risk, observations, pname
    )
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
        finding="risk" if risk in ("elevated", "blocking") else "neutral",
    )

    clearance_obs = [
        o
        for o in observations
        if (o.get("detail") or {}).get("finding") == "clearance"
        or (
            isinstance(o.get("observation"), str)
            and "no " in o["observation"].lower()
            and o.get("local_risk") == "nominal"
        )
    ]
    risk_obs = [
        o
        for o in observations
        if o.get("local_risk") in ("elevated", "blocking")
        or (o.get("detail") or {}).get("finding") == "risk"
    ]
    not_causal_steps: list[dict[str, Any]] = []
    if clearance_obs and risk_obs and risk in ("elevated", "blocking"):
        cleared = ", ".join(
            sorted({str(o.get("agent")) for o in clearance_obs if o.get("agent")})
        )
        not_causal_steps.append(
            make_step(
                "orchestrator",
                "observation",
                (
                    "Cleared domains are not causal for the active compound risk"
                    + (f" ({cleared})" if cleared else "")
                    + "."
                ),
                review_id=review_id,
                assessment_id=assessment_id,
                detail={
                    "cleared_agents": [o.get("agent") for o in clearance_obs],
                    "risk_agents": [o.get("agent") for o in risk_obs],
                },
                finding="clearance",
            ).model_dump()
        )

    done = make_step(
        "orchestrator",
        "completed",
        "Orchestrator assessment complete",
        review_id=review_id,
        assessment_id=assessment_id,
    )

    out: dict[str, Any] = {
        "verdict": result.model_dump(),
        "grounded_fact_types": grounded,
        "spatial_links": spatial_links,
        "agent_trace": [
            started.model_dump(),
            verdict_step.model_dump(),
            *not_causal_steps,
            done.model_dump(),
        ],
    }
    if orch_usage is not None:
        out["llm_usage"] = [orch_usage]
    return out
