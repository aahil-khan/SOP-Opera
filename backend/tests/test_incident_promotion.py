"""Pure tests for promoting closure reports into the historical-incident corpus."""

from __future__ import annotations

from uuid import UUID, uuid4

from app.incidents.service import (
    build_description,
    incident_id_for_review,
    primary_category,
    should_promote,
)
from app.reports.packet import PacketFact
from tests.report_fixtures import make_packet


def test_incident_id_is_stable_per_review():
    review_id = UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    assert incident_id_for_review(review_id) == incident_id_for_review(review_id)
    assert incident_id_for_review(review_id) != incident_id_for_review(uuid4())


def test_should_promote_elevated_or_held():
    packet = make_packet()
    assert should_promote(packet) is True

    packet.assessment.risk_level = "nominal"
    packet.decision.outcome = "approved"
    assert should_promote(packet) is False

    packet.decision.outcome = "approved_with_conditions"
    assert should_promote(packet) is True

    packet.decision.outcome = "approved"
    packet.assessment.risk_level = "elevated"
    assert should_promote(packet) is True


def test_primary_category_prefers_incident_backed_facts():
    packet = make_packet()
    assert primary_category(packet) == "elevated_gas"

    packet.facts = [
        PacketFact(fact_type="effluent_quality_breach", label="Effluent"),
        PacketFact(fact_type="zone_occupied", label="Zone occupied"),
    ]
    assert primary_category(packet) == "zone_occupied"


def test_build_description_has_echo_friendly_title():
    packet = make_packet()
    desc = build_description(packet)
    assert desc.startswith("Plant closure SOP-")
    assert ":" in desc
    assert "Coke Oven Battery 3" in desc
    assert "Blocked" in desc
    assert "Gas above the early-warning threshold" in desc


def test_build_description_truncates_long_summary():
    packet = make_packet()
    assert packet.assessment is not None
    packet.assessment.summary = "x" * 500
    desc = build_description(packet)
    assert "…" in desc
    # Keep the chunk embeddable — well under a typical token budget.
    assert len(desc) < 450
