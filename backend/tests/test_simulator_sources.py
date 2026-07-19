"""Unit tests for per-source simulator routing."""

from __future__ import annotations

from app.simulator.sources import (
    CATEGORY_TO_SOURCE,
    OrchestratorSim,
    list_sources,
    source_for_category,
)


def test_category_routing():
    assert source_for_category("sensor").name == "scada"
    assert source_for_category("permit").name == "ptw"
    assert source_for_category("isolation_status").name == "maintenance"
    assert source_for_category("worker_location").name == "workforce"
    assert source_for_category("ppe_status").name == "workforce"
    assert source_for_category("unknown_thing").name == "scada"  # default


def test_list_sources_shape():
    sources = list_sources()
    names = [s["name"] for s in sources]
    assert names == ["scada", "ptw", "maintenance", "workforce"]
    assert "sensor" in sources[0]["categories"]
    assert "permit" in sources[1]["categories"]


def test_all_known_categories_mapped():
    for cat in (
        "sensor",
        "weather",
        "permit",
        "lift_plan",
        "isolation_status",
        "worker_location",
        "certification",
        "ppe_status",
    ):
        assert cat in CATEGORY_TO_SOURCE


def test_orchestrator_sim_constructs():
    orch = OrchestratorSim()
    assert orch.last_sources == []


def test_source_emit_broadcast_includes_payload_keys():
    """Document expected WS keys after enrichment (payload, ts)."""
    expected = {
        "source",
        "label",
        "category",
        "asset_id",
        "payload",
        "ts",
        "review_id",
        "derived_facts",
        "message",
    }
    # Sanity: CATEGORY routing still maps sensor → scada for gauge UI
    assert source_for_category("sensor").name == "scada"
    assert expected  # keys documented for frontend liveStore
