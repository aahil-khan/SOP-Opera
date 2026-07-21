"""Spatial Agent — queries the knowledge graph for hazard / permit co-occurrence."""

from __future__ import annotations

from typing import Any

from app.agents.events import make_step
from app.agents.state import AgentObservation, AgentState
from app.core.config import get_settings
from app.graph.kg import find_spatial_cooccurrences, get_plant_graph, neighbors_within_radius


def _gas_assets(state: AgentState) -> set[str]:
    assets: set[str] = set()
    if "elevated_gas" in (state.get("fact_types") or []):
        assets.add(str(state.get("asset_id")))
    for e in state.get("plant_context_entries") or state.get("context_entries") or []:
        if e.get("category") != "sensor":
            continue
        reading = (e.get("payload") or {}).get("gas_reading")
        if isinstance(reading, (int, float)) and float(reading) > get_settings().gas_elevated_threshold:
            aid = e.get("asset_id")
            if aid:
                assets.add(str(aid))
    for o in state.get("observations") or []:
        if "elevated_gas" not in (o.get("fact_types") or []):
            continue
        # Attribute the reading to the asset the observation actually described.
        # This used to add `state["asset_id"]` unconditionally, which pinned every
        # agent-reported gas fact to the review's own asset — so in a cross-asset
        # scenario the spatial link would name the wrong location as the source.
        aid = o.get("asset_id") or state.get("asset_id")
        if aid:
            assets.add(str(aid))
    return assets


def _hot_work_assets(state: AgentState) -> set[str]:
    assets: set[str] = set()
    entries = list(state.get("plant_context_entries") or []) + list(
        state.get("context_entries") or []
    )
    for e in entries:
        if e.get("category") != "permit":
            continue
        payload = e.get("payload") or {}
        if payload.get("status") != "active":
            continue
        if payload.get("work_type") != "hot_work":
            continue
        aid = e.get("asset_id")
        if aid:
            assets.add(str(aid))
    return assets


async def spatial_agent(state: AgentState) -> dict[str, Any]:
    review_id = state.get("review_id")
    assessment_id = state.get("assessment_id")
    focus = str(state.get("asset_id") or "")
    settings = get_settings()

    started = make_step(
        "spatial",
        "started",
        (
            f"Spatial Agent querying KG within "
            f"{settings.agent_spatial_radius_m}m of {state.get('asset_name')}"
        ),
        review_id=review_id,
        assessment_id=assessment_id,
    )

    g = get_plant_graph()
    near = neighbors_within_radius(g, focus) if focus else []
    tool_step = make_step(
        "spatial",
        "tool_call",
        f"KG neighborhood: {len(near)} asset(s) within radius",
        review_id=review_id,
        assessment_id=assessment_id,
        detail={"neighbors": near[:8]},
    )

    gas_ids = _gas_assets(state)
    hot_ids = _hot_work_assets(state)
    links = find_spatial_cooccurrences(
        focus_asset_id=focus,
        gas_asset_ids=gas_ids,
        hot_work_asset_ids=hot_ids,
        g=g,
    )

    spatial_links = [
        {
            "from_asset_id": L.from_asset_id,
            "to_asset_id": L.to_asset_id,
            "from_label": L.from_label,
            "to_label": L.to_label,
            "relation": L.relation,
            "distance_m": L.distance_m,
            "floors_apart": L.floors_apart,
            "reason": L.reason,
        }
        for L in links
    ]

    if links:
        observation = (
            "Compound spatial risk — "
            + "; ".join(L.reason for L in links[:3])
        )
        # `find_spatial_cooccurrences` already filters to the configured radius, so
        # re-testing `distance_m <= radius` here was always true and the "elevated"
        # branch was unreachable. Grade by proximity instead: a co-occurrence inside
        # half the radius is materially tighter than one at its edge.
        closest = min(L.distance_m for L in links)
        risk = (
            "blocking"
            if closest <= settings.agent_spatial_radius_m / 2
            else "elevated"
        )
        fact_types = ["spatial_cooccurrence"]
        finding = "risk"
    else:
        observation = (
            "No hot-work / gas co-occurrence within spatial radius."
        )
        risk = "nominal"
        fact_types = []
        finding = "clearance"

    obs: AgentObservation = {
        "agent": "spatial",
        "observation": observation,
        "local_risk": risk,
        "fact_types": fact_types,
        "detail": {
            "spatial_links": spatial_links,
            "neighbors": near[:8],
            "finding": finding,
        },
    }

    steps = [
        started.model_dump(),
        tool_step.model_dump(),
        make_step(
            "spatial",
            "observation",
            observation,
            review_id=review_id,
            assessment_id=assessment_id,
            detail={
                "spatial_links": spatial_links,
                "gas_assets": sorted(gas_ids),
                "hot_work_assets": sorted(hot_ids),
            },
            finding=finding,  # type: ignore[arg-type]
        ).model_dump(),
        make_step(
            "spatial",
            "local_risk",
            f"Spatial Agent local risk → {risk}",
            review_id=review_id,
            assessment_id=assessment_id,
            detail={"local_risk": risk, "link_count": len(links)},
        ).model_dump(),
        make_step(
            "spatial",
            "completed",
            "Spatial Agent complete",
            review_id=review_id,
            assessment_id=assessment_id,
        ).model_dump(),
    ]

    return {
        "observations": [obs],
        "agent_trace": steps,
        "spatial_links": spatial_links,
    }
