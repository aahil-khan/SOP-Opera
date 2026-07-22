"""LangGraph StateGraph for multi-agent compound-risk assessment."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any
from uuid import UUID

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send
from shared.python.schemas import DerivedFact, RecommendationIn, RetrievedReference

from app.agents.events import AgentStep, broadcast_agent_step
from app.agents.llm import model_label, provider_label, sum_usage
from app.agents.llm_outcomes import summarize_llm_outcomes
from app.agents.nodes.incident_pattern import incident_pattern_agent
from app.agents.nodes.investigation import investigation_agent
from app.agents.nodes.orchestrator import orchestrator_agent
from app.agents.nodes.predictive_trend import predictive_trend_agent
from app.agents.nodes.shift_handover import shift_handover_agent
from app.agents.nodes.source import (
    maintenance_agent,
    permit_agent,
    scada_agent,
    workforce_agent,
)
from app.agents.nodes.spatial import spatial_agent
from app.agents.routing import (
    SOURCE_AGENTS,
    select_source_agents,
    should_run_enrichment,
    should_run_predictive_trend,
    should_run_shift_handover,
    should_run_spatial,
)
from app.agents.state import AgentState
from app.assessment.schemas import AssessmentResult, ProviderGeneration
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_compiled = None
_provider_override: str | None = None


def _join_sources(state: AgentState) -> dict[str, Any]:
    """No-op barrier after gated source fan-out."""
    return {}


def _join_analysis(state: AgentState) -> dict[str, Any]:
    """No-op barrier after spatial / trend fan-out."""
    return {}


def _fan_out_sources(state: AgentState) -> list[Send]:
    selected = select_source_agents(state)
    if not selected:
        return [Send("join_sources", state)]
    return [Send(name, state) for name in selected]


def _fan_out_analysis(state: AgentState) -> list[Send]:
    sends: list[Send] = []
    if should_run_spatial(state):
        sends.append(Send("spatial", state))
    if should_run_predictive_trend(state):
        sends.append(Send("predictive_trend", state))
    # Pre-verdict, unlike the enrichment agents: an unacknowledged carry-forward
    # is an input to the risk policy, so it has to reach the orchestrator.
    if should_run_shift_handover(state):
        sends.append(Send("shift_handover", state))
    if not sends:
        sends.append(Send("join_analysis", state))
    return sends


def _fan_out_enrichment(state: AgentState) -> list[Send] | Any:
    if should_run_enrichment(state):
        return [Send("incident_pattern", state)]
    return END


def build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("scada", scada_agent)
    builder.add_node("permit", permit_agent)
    builder.add_node("maintenance", maintenance_agent)
    builder.add_node("workforce", workforce_agent)
    builder.add_node("join_sources", _join_sources)
    builder.add_node("join_analysis", _join_analysis)
    builder.add_node("predictive_trend", predictive_trend_agent)
    builder.add_node("spatial", spatial_agent)

    async def orch(state: AgentState) -> dict[str, Any]:
        return await orchestrator_agent(state, provider_name=_provider_override)

    builder.add_node("orchestrator", orch)
    builder.add_node("incident_pattern", incident_pattern_agent)
    builder.add_node("investigation", investigation_agent)
    builder.add_node("shift_handover", shift_handover_agent)

    builder.add_conditional_edges(START, _fan_out_sources, [*SOURCE_AGENTS, "join_sources"])
    for name in SOURCE_AGENTS:
        builder.add_edge(name, "join_sources")
    builder.add_conditional_edges(
        "join_sources",
        _fan_out_analysis,
        ["spatial", "predictive_trend", "shift_handover", "join_analysis"],
    )
    builder.add_edge("spatial", "join_analysis")
    builder.add_edge("predictive_trend", "join_analysis")
    builder.add_edge("shift_handover", "join_analysis")
    builder.add_edge("join_analysis", "orchestrator")
    builder.add_conditional_edges(
        "orchestrator",
        _fan_out_enrichment,
        ["incident_pattern", END],
    )
    # incident_pattern writes incident_echoes into state; investigation reads them
    # to headline its advisory, so it runs strictly after. Both are post-verdict and
    # cannot alter risk_level (they return only observations / agent_trace).
    builder.add_edge("incident_pattern", "investigation")
    builder.add_edge("investigation", END)
    return builder.compile()


def get_compiled_graph():
    global _compiled
    if _compiled is None:
        _compiled = build_graph()
    return _compiled


def reset_compiled_graph() -> None:
    global _compiled
    _compiled = None


def _serialize_fact(f: DerivedFact) -> dict[str, Any]:
    return {
        "id": str(f.id),
        "asset_id": str(f.asset_id),
        "fact_type": f.fact_type,
        "value": f.value,
        "computed_at": f.computed_at.isoformat()
        if hasattr(f.computed_at, "isoformat")
        else str(f.computed_at),
        "source_context_ids": [str(i) for i in f.source_context_ids],
    }


def _serialize_ref(r: RetrievedReference) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "source": r.source,
        "retrieval_path": r.retrieval_path,
        "score": r.score,
        "chunk_id": str(r.chunk_id) if getattr(r, "chunk_id", None) else None,
        "title": getattr(r, "title", None),
        "snippet": getattr(r, "snippet", None),
        "code": getattr(r, "code", None),
        "triggered_by_fact": getattr(r, "triggered_by_fact", None),
    }


async def run_agent_assessment(
    *,
    review_id: UUID,
    assessment_id: UUID,
    asset_id: UUID,
    asset_name: str,
    asset_zone: str,
    facts: list[DerivedFact],
    context_entries: list[dict[str, Any]],
    retrieved_references: list[RetrievedReference],
    provider_name: str | None = None,
    plant_context_entries: list[dict[str, Any]] | None = None,
    carried_handover_items: list[dict[str, Any]] | None = None,
) -> tuple[
    ProviderGeneration,
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
]:
    """
    Run the LangGraph multi-agent assessment.
    Returns (ProviderGeneration, agent_trace, spatial_links).
    """
    global _provider_override
    settings = get_settings()
    _provider_override = provider_name or settings.ai_provider

    if settings.langchain_tracing_v2 and settings.langchain_api_key:
        from app.agents.llm import configure_langsmith

        configure_langsmith()

    fact_types = [f.fact_type for f in facts]
    plant_ctx = plant_context_entries if plant_context_entries is not None else context_entries
    initial: AgentState = {
        "review_id": str(review_id),
        "assessment_id": str(assessment_id),
        "asset_id": str(asset_id),
        "asset_name": asset_name,
        "asset_zone": asset_zone,
        "fact_types": fact_types,
        "facts": [_serialize_fact(f) for f in facts],
        "context_entries": context_entries,
        "plant_context_entries": plant_ctx,
        "retrieved_references": [_serialize_ref(r) for r in retrieved_references],
        "observations": [],
        "agent_trace": [],
        "spatial_links": [],
        "trend_forecasts": [],
        "incident_echoes": [],
        "carried_handover_items": list(carried_handover_items or []),
        "verdict": None,
        "grounded_fact_types": [],
        "provider_name": _provider_override,
        "llm_usage": [],
        "llm_outcomes": [],
    }

    graph = get_compiled_graph()
    t0 = time.perf_counter()
    seen_steps = 0
    final_state: dict[str, Any] = dict(initial)
    timeout = settings.agent_timeout_seconds

    try:
        async with asyncio.timeout(timeout):
            async for event in graph.astream(initial, stream_mode="updates"):
                for _node, update in event.items():
                    if not isinstance(update, dict):
                        continue
                    for key, value in update.items():
                        if key in (
                            "observations",
                            "agent_trace",
                            "llm_usage",
                            "llm_outcomes",
                        ) and isinstance(value, list):
                            existing = list(final_state.get(key) or [])
                            existing.extend(value)
                            final_state[key] = existing
                        else:
                            final_state[key] = value
                    trace = list(final_state.get("agent_trace") or [])
                    while seen_steps < len(trace):
                        step_dict = trace[seen_steps]
                        seen_steps += 1
                        try:
                            step = AgentStep.model_validate(step_dict)
                            await broadcast_agent_step(step)
                        except Exception as exc:  # noqa: BLE001
                            logger.debug("skip bad agent step: %s", exc)
    except TimeoutError as exc:
        raise RuntimeError(
            f"LangGraph assessment timed out after {timeout}s"
        ) from exc

    latency_ms = int((time.perf_counter() - t0) * 1000)
    verdict = final_state.get("verdict")
    if not verdict:
        raise RuntimeError("LangGraph orchestrator did not produce a verdict")

    result = AssessmentResult.model_validate(verdict)
    result = AssessmentResult(
        summary=result.summary,
        risk_level=result.risk_level,
        recommendations=[
            RecommendationIn(text=r.text, rationale=r.rationale)
            for r in result.recommendations
        ],
        confidence=result.confidence,
    )

    tin, tout, cost = sum_usage(list(final_state.get("llm_usage") or []))
    generation = ProviderGeneration(
        result=result,
        provider=f"langgraph:{provider_label(provider_name)}",
        model=model_label(provider_name),
        input_tokens=tin,
        output_tokens=tout,
        estimated_cost_usd=round(cost, 8),
        latency_ms=latency_ms,
    )
    trace = list(final_state.get("agent_trace") or [])
    spatial_links = list(final_state.get("spatial_links") or [])
    llm_stats = summarize_llm_outcomes(
        list(final_state.get("llm_outcomes") or []),
        provider=provider_name or _provider_override,
    )
    logger.info(
        "langgraph assessment complete review=%s risk=%s steps=%d spatial=%d latency=%dms degraded=%s",
        review_id,
        result.risk_level,
        len(trace),
        len(spatial_links),
        latency_ms,
        llm_stats.get("degraded"),
    )
    return generation, trace, spatial_links, llm_stats
