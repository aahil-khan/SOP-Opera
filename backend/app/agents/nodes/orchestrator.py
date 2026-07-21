"""Orchestrator agent — fuses source observations into a grounded assessment."""

from __future__ import annotations

from typing import Any

from shared.python.schemas import RecommendationIn

from app.agents.events import make_step
from app.agents.llm import get_chat_model, model_label, provider_label, usage_record
from app.agents.llm_outcomes import make_outcome, short_error
from app.agents.state import AgentState
from app.agents.tools.rules import RuleToolkit, require_grounding_for_block
from app.assessment.providers.mock import FACT_RECOMMENDATIONS
from app.reviews.concerns import SUPERVISOR_FACT_TYPES
from app.risk import policy as risk_policy
from app.assessment.schemas import AssessmentResult
from app.core.config import get_settings
from app.context.lead_time import compute_lead_time_for_verdict


def _fuse_verdict(
    grounded: list[str], observations: list[dict[str, Any]]
) -> risk_policy.RiskVerdict:
    """Delegate to the one risk policy — see app/risk/policy.py."""
    return risk_policy.classify(grounded, observations)


def _fuse_risk(grounded: list[str], observations: list[dict[str, Any]]) -> str:
    return _fuse_verdict(grounded, observations).level


def _recommendations(
    grounded: list[str],
    observations: list[dict[str, Any]],
    *,
    context_entries: list[dict[str, Any]] | None = None,
    asset_name: str = "this asset",
) -> list[RecommendationIn]:
    from app.assessment.reasoning import METRIC_FACT_TYPES, format_fact_detail

    recs: list[RecommendationIn] = []
    rec_facts = sorted(f for f in grounded if f != "spatial_cooccurrence")
    if any(
        "predicted_trend_risk" in (o.get("fact_types") or [])
        for o in observations
    ) and "predicted_trend_risk" not in rec_facts:
        rec_facts.append("predicted_trend_risk")
    entries = list(context_entries or [])
    for ft in rec_facts:
        text, rationale = FACT_RECOMMENDATIONS.get(
            ft,
            (
                f"Review and mitigate '{ft.replace('_', ' ')}'.",
                f"{ft.replace('_', ' ').title()} requires supervisor action.",
            ),
        )
        if ft in METRIC_FACT_TYPES and entries:
            rationale = format_fact_detail(
                ft, entries, asset_name=asset_name
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
                rationale="No elevated conditions at assessment time.",
            )
        )
    return recs


def _indian_reg_priority(r: dict[str, Any]) -> int:
    code = str(r.get("code") or r.get("title") or "")
    if (
        code.startswith("OISD")
        or code.startswith("DGMS")
        or code.startswith("Factory Act")
        or code.startswith("SOP-OISD")
        or code.startswith("SOP-Factory Act")
    ):
        return 0
    return 1


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
    standards = sorted(
        [
            r
            for r in refs
            if r.get("source") in ("regulations", "sops")
            and (r.get("title") or r.get("snippet") or r.get("code"))
        ],
        key=_indian_reg_priority,
    )
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


def _supervisor_only_grounded(grounded: list[str]) -> bool:
    """True when every grounded fact came from a supervisor floor report."""
    rule_facts = [f for f in grounded if f != "spatial_cooccurrence"]
    return bool(rule_facts) and all(f in SUPERVISOR_FACT_TYPES for f in rule_facts)


def _supervisor_report_anchor(state: AgentState, grounded: list[str]) -> str | None:
    from app.assessment.reasoning import format_fact_detail

    asset = str(state.get("asset_name") or "this asset")
    entries = list(state.get("context_entries") or [])
    supervisor_facts = sorted(f for f in grounded if f in SUPERVISOR_FACT_TYPES)
    if not supervisor_facts:
        return None
    return format_fact_detail(supervisor_facts[0], entries, asset_name=asset)


def _build_supervisor_summary_prompt(
    state: AgentState,
    grounded: list[str],
    risk: str,
    report_anchor: str,
) -> str:
    citations = _pick_citation_refs(list(state.get("retrieved_references") or []))
    if citations:
        ref_block = "Retrieved context (cite at most one title/code only if directly relevant):\n" + "\n".join(
            f"- {_format_ref_line(r)}" for r in citations
        )
    else:
        ref_block = "Retrieved context: (none)"

    return (
        "You are an industrial safety orchestrator.\n"
        "A floor supervisor filed the report below. Write 1-2 plain sentences for the operator.\n"
        "Rules:\n"
        "- Restate only what is in the supervisor report and grounded facts.\n"
        "- Do NOT invent causes, root causes, workflow impacts, communication gaps, "
        "or 'compounded risk' language.\n"
        "- Do NOT speculate about accidents, inefficiencies, or missing protocols.\n"
        "- Never invent references or facts not listed.\n\n"
        f"Asset: {state.get('asset_name')} zone={state.get('asset_zone')}\n"
        f"Grounded facts: {grounded}\n"
        f"Fused risk: {risk}\n"
        f"Supervisor report: {report_anchor}\n\n"
        f"{ref_block}\n"
    )


def _build_summary_prompt(
    state: AgentState,
    grounded: list[str],
    risk: str,
    observations: list[dict[str, Any]],
) -> str:
    """Compose orch LLM prompt: fuse domain narratives; cite retrieved refs."""
    if _supervisor_only_grounded(grounded):
        anchor = _supervisor_report_anchor(state, grounded)
        if anchor:
            return _build_supervisor_summary_prompt(state, grounded, risk, anchor)

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

    supervisor_facts = [f for f in grounded if f in SUPERVISOR_FACT_TYPES]
    supervisor_guard = ""
    if supervisor_facts:
        supervisor_guard = (
            "When supervisor_report facts are present, quote the supervisor's observation; "
            "do not invent additional causes beyond the listed observations and facts.\n"
        )

    return (
        "You are an industrial safety orchestrator.\n"
        "Domain observations below are already domain-specific narratives — "
        "synthesize the compound risk in 3-5 sentences. "
        "Do not paste domain observations back verbatim. "
        f"{supervisor_guard}"
        "Cite at most the retrieved titles/codes when relevant; "
        "never invent references or facts not listed.\n\n"
        f"Asset: {state.get('asset_name')} zone={state.get('asset_zone')}\n"
        f"Grounded facts: {grounded}\n"
        f"Fused risk: {risk}\n"
        f"Observations:\n{obs_lines}\n\n"
        f"{ref_block}\n"
    )


def _clean_observation(text: str) -> str:
    """Strip agent-title prefixes so the fused summary stays operator-readable."""
    prefixes = (
        "SCADA / Sensor Agent:",
        "Permit / PTW Agent:",
        "Maintenance Agent:",
        "Workforce / Zone Agent:",
        "Spatial Agent:",
        "Incident Agent:",
        "Handover Agent:",
        "Forecast Agent:",
    )
    cleaned = text.strip()
    for prefix in prefixes:
        if cleaned.lower().startswith(prefix.lower()):
            cleaned = cleaned[len(prefix) :].strip()
            break
    return cleaned


def _is_clearance_observation(o: dict[str, Any]) -> bool:
    """True when the agent found nothing relevant — omit from issue summary."""
    detail = o.get("detail") or {}
    if isinstance(detail, dict) and detail.get("finding") == "clearance":
        return True
    fact_types = o.get("fact_types") or []
    if o.get("local_risk") == "nominal" and not fact_types:
        return True
    obs = str(o.get("observation") or "").lower()
    clearance_phrases = (
        "no active hazards",
        "no hot-work",
        "no co-occurrence",
        "no imminent threshold",
        "nothing to report",
    )
    return any(p in obs for p in clearance_phrases)


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
        if _is_clearance_observation(o):
            continue
        obs = _clean_observation(str(o.get("observation") or ""))
        if not obs:
            continue
        # Keep each agent note short for the panel.
        if len(obs) > 140:
            obs = obs[:137].rstrip() + "…"
        label = {
            "scada": "Sensors",
            "permit": "Permits",
            "maintenance": "Maintenance",
            "workforce": "Crew",
            "spatial": "Nearby area",
            "incident_pattern": "Past incidents",
            "shift_handover": "Shift notes",
            "predictive_trend": "Forecast",
        }.get(agent, agent.replace("_", " ").title())
        highlights.append(f"{label}: {obs}")

    if highlights:
        bullets = "\n".join(f"• {h}" for h in highlights[:4])
        body = f"{lead}\n\n{bullets}"
    else:
        body = lead

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
) -> tuple[str | None, dict[str, Any] | None, dict[str, Any] | None]:
    model = get_chat_model(provider_name)
    if model is None:
        return None, None, None
    try:
        prompt = _build_summary_prompt(state, grounded, risk, observations)
        result = await model.ainvoke(prompt)
        usage = usage_record(
            agent="orchestrator", response=result, provider_name=provider_name
        )
        content = getattr(result, "content", None)
        if isinstance(content, str) and content.strip():
            return content.strip(), usage, make_outcome("orchestrator", "ok")
        return (
            None,
            usage,
            make_outcome("orchestrator", "fallback", reason="empty_response"),
        )
    except Exception as exc:  # noqa: BLE001
        return (
            None,
            None,
            make_outcome("orchestrator", "fallback", reason=short_error(exc)),
        )


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
    summary, orch_usage, orch_outcome = await _llm_summary(
        state, grounded, risk, observations, pname
    )
    fallback_steps: list[dict[str, Any]] = []
    llm_outcomes: list[dict[str, Any]] = []
    if orch_outcome is not None:
        llm_outcomes.append(orch_outcome)
    if summary is None:
        summary = _mock_summary(state, grounded, risk, observations)
        if orch_outcome is not None and orch_outcome.get("status") == "fallback":
            fallback_steps.append(
                make_step(
                    "orchestrator",
                    "error",
                    (
                        "LLM summary unavailable — using deterministic template "
                        f"({orch_outcome.get('reason', 'unknown')})"
                    ),
                    review_id=review_id,
                    assessment_id=assessment_id,
                    detail={
                        **orch_outcome,
                        "narration_mode": "template_fallback",
                    },
                ).model_dump()
            )

    recs = _recommendations(
        grounded,
        observations,
        context_entries=list(state.get("context_entries") or []),
        asset_name=str(state.get("asset_name") or "this asset"),
    )
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

    lead_time_seconds = compute_lead_time_for_verdict(
        list(state.get("context_entries") or []),
        grounded,
        risk,
    )
    trend_forecasts = list(state.get("trend_forecasts") or [])

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
            "lead_time_seconds": lead_time_seconds,
            "trend_forecasts": trend_forecasts,
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
            *fallback_steps,
            verdict_step.model_dump(),
            *not_causal_steps,
            done.model_dump(),
        ],
    }
    if orch_usage is not None:
        out["llm_usage"] = [orch_usage]
    if llm_outcomes:
        out["llm_outcomes"] = llm_outcomes
    return out
