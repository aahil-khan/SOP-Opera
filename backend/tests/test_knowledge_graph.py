"""Unit tests for knowledge graph + Spatial Agent."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.agents.graph import reset_compiled_graph, run_agent_assessment
from app.graph.kg import (
    build_knowledge_graph,
    find_spatial_cooccurrences,
    neighbors_within_radius,
    reset_plant_graph_cache,
    serialize_graph,
)
from shared.python.schemas import DerivedFact

VESSEL_A = "11111111-1111-1111-1111-111111111111"
WALKWAY_3 = "22222222-2222-2222-2222-222222222222"
COMPRESSOR_B = "33333333-3333-3333-3333-333333333333"
FIRE_WATER = "77777777-7777-7777-7777-777777777709"


@pytest.fixture(autouse=True)
def _reset_graph_cache():
    reset_plant_graph_cache()
    reset_compiled_graph()
    yield
    reset_plant_graph_cache()
    reset_compiled_graph()


def test_kg_builds_assets_and_near_edges():
    g = build_knowledge_graph()
    assert g.has_node(f"asset:{VESSEL_A}")
    snap = serialize_graph(g)
    assert len(snap["nodes"]) > 20
    assert any(e.get("relation") == "NEAR" for e in snap["edges"])
    near = neighbors_within_radius(g, VESSEL_A)
    # Walkway 3 should be within radius at default scale 0.04
    ids = {n["asset_id"] for n in near}
    assert WALKWAY_3 in ids


def test_neighbors_resolve_vertical_direction():
    g = build_knowledge_graph()
    from_fire = {
        n["asset_id"]: n for n in neighbors_within_radius(g, FIRE_WATER)
    }
    assert from_fire[COMPRESSOR_B]["relation"] == "BELOW"
    from_compressor = {
        n["asset_id"]: n for n in neighbors_within_radius(g, COMPRESSOR_B)
    }
    assert from_compressor[FIRE_WATER]["relation"] == "ABOVE"


def test_spatial_cooccurrence_same_asset():
    links = find_spatial_cooccurrences(
        focus_asset_id=VESSEL_A,
        gas_asset_ids={VESSEL_A},
        hot_work_asset_ids={VESSEL_A},
    )
    assert links
    assert links[0].distance_m == 0.0


def test_spatial_cooccurrence_cross_asset():
    links = find_spatial_cooccurrences(
        focus_asset_id=VESSEL_A,
        gas_asset_ids={VESSEL_A},
        hot_work_asset_ids={WALKWAY_3},
    )
    assert links
    assert links[0].to_asset_id == WALKWAY_3
    assert links[0].distance_m <= 15.0


@pytest.mark.asyncio
async def test_langgraph_spatial_blocks_on_gas_plus_hot_work():
    asset_id = UUID(VESSEL_A)
    now = datetime.now(timezone.utc)
    facts = [
        DerivedFact(
            id=uuid4(),
            asset_id=asset_id,
            fact_type="elevated_gas",
            value=True,
            computed_at=now,
            source_context_ids=[],
        )
    ]
    context = [
        {
            "id": str(uuid4()),
            "asset_id": VESSEL_A,
            "category": "sensor",
            "payload": {"gas_reading": 28.0},
            "provider": "test",
        },
        {
            "id": str(uuid4()),
            "asset_id": VESSEL_A,
            "category": "permit",
            "payload": {
                "permit_id": "p-hot",
                "status": "active",
                "work_type": "hot_work",
            },
            "provider": "test",
        },
    ]
    generation, trace, spatial_links, _stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=asset_id,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=facts,
        context_entries=context,
        retrieved_references=[],
        provider_name="mock",
        plant_context_entries=context,
    )
    assert spatial_links
    assert generation.result.risk_level == "blocking"
    agents = {s["agent"] for s in trace}
    assert "spatial" in agents
    assert any(s["kind"] == "verdict" for s in trace)


@pytest.mark.asyncio
async def test_langgraph_compound_still_blocking():
    asset_id = UUID(VESSEL_A)
    now = datetime.now(timezone.utc)
    facts = [
        DerivedFact(
            id=uuid4(),
            asset_id=asset_id,
            fact_type=ft,
            value=True,
            computed_at=now,
            source_context_ids=[],
        )
        for ft in ("elevated_gas", "permit_conflict", "zone_occupied")
    ]
    generation, trace, _links, _stats = await run_agent_assessment(
        review_id=uuid4(),
        assessment_id=uuid4(),
        asset_id=asset_id,
        asset_name="Vessel A",
        asset_zone="coke-oven-battery",
        facts=facts,
        context_entries=[],
        retrieved_references=[],
        provider_name="mock",
    )
    assert generation.result.risk_level == "blocking"
    assert "spatial" in {s["agent"] for s in trace}
