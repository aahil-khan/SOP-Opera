"""Knowledge graph HTTP surface."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from app.core.config import get_settings
from app.graph.kg import get_plant_graph, neighbors_within_radius, serialize_graph

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("")
async def get_graph() -> dict:
    """Full plant knowledge graph snapshot (nodes + edges) for viz."""
    return serialize_graph()


@router.get("/neighbors/{asset_id}")
async def get_neighbors(
    asset_id: UUID,
    radius_m: float | None = Query(default=None),
) -> dict:
    settings = get_settings()
    radius = radius_m if radius_m is not None else settings.agent_spatial_radius_m
    g = get_plant_graph()
    node = f"asset:{asset_id}"
    if node not in g:
        raise HTTPException(status_code=404, detail="asset not in knowledge graph")
    return {
        "asset_id": str(asset_id),
        "radius_m": radius,
        "neighbors": neighbors_within_radius(g, str(asset_id), radius_m=radius),
    }
