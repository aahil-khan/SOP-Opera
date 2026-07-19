"""LangGraph StateGraph for multi-agent compound-risk assessment."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any
from uuid import UUID

from langgraph.graph import END, START, StateGraph
from shared.python.schemas import DerivedFact, RecommendationIn, RetrievedReference

from app.agents.events import AgentStep, broadcast_agent_step
from app.agents.llm import model_label, provider_label
from app.agents.nodes.incident_pattern import incident_pattern_agent
from app.agents.nodes.orchestrator import orchestrator_agent
from app.agents.nodes.shift_handover import shift_handover_agent
from app.agents.nodes.source import (
    maintenance_agent,
    permit_agent,
    scada_agent,
    workforce_agent,
)
from app.agents.nodes.spatial import spatial_agent
from app.agents.state import AgentState
from app.assessment.schemas import AssessmentResult, ProviderGeneration
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_compiled = None
_provider_override: str | None = None


def build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("scada", scada_agent)
    builder.add_node("permit", permit_agent)
    builder.add_node("maintenance", maintenance_agent)
    builder.add_node("workforce", workforce_agent)
    builder.add_node("spatial", spatial_agent)
    builder.add_node("incident_pattern", incident_pattern_agent)
    builder.add_node("shift_handover", shift_handover_agent)

    async def orch(state: AgentState) -> dict[str, Any]:
        return await orchestrator_agent(state, provider_name=_provider_override)

    builder.add_node("orchestrator", orch)

    for node in (
        "scada",
        "permit",
        "maintenance",
        "workforce",
        "spatial",
        "incident_pattern",
        "shift_handover",
    ):
        builder.add_edge(START, node)
        builder.add_edge(node, "orchestrator")
    builder.add_edge("orchestrator", END)
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
        "snippet": getattr(r, "snippet", None),
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
) -> tuple[ProviderGeneration, list[dict[str, Any]], list[dict[str, Any]]]:
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
        "incident_echoes": [],
        "shift_handover_note": None,
        "verdict": None,
        "grounded_fact_types": [],
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
                        if key in ("observations", "agent_trace") and isinstance(
                            value, list
                        ):
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

    generation = ProviderGeneration(
        result=result,
        provider=f"langgraph:{provider_label(provider_name)}",
        model=model_label(provider_name),
        input_tokens=80 + 15 * len(fact_types),
        output_tokens=60 + 10 * len(result.recommendations),
        estimated_cost_usd=0.0,
        latency_ms=latency_ms,
    )
    trace = list(final_state.get("agent_trace") or [])
    spatial_links = list(final_state.get("spatial_links") or [])
    logger.info(
        "langgraph assessment complete review=%s risk=%s steps=%d spatial=%d latency=%dms",
        review_id,
        result.risk_level,
        len(trace),
        len(spatial_links),
        latency_ms,
    )
    return generation, trace, spatial_links
