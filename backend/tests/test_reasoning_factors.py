"""Unit tests for deterministic evidence-linked reasoning factors."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from app.assessment.reasoning import build_reasoning_factors
from shared.python.schemas import (
    AreaOwner,
    DerivedFact,
    RetrievedReference,
)

ASSET = UUID("11111111-1111-1111-1111-111111111111")
REG_ID = UUID("a1111111-1111-1111-1111-111111111101")
SOP_ID = UUID("b2222222-2222-2222-2222-222222222201")
INC_ID = UUID("c3333333-3333-3333-3333-333333333301")


def _fact(fact_type: str, source_id: UUID | None = None) -> DerivedFact:
    return DerivedFact(
        id=uuid4(),
        asset_id=ASSET,
        fact_type=fact_type,
        value=True,
        computed_at=datetime.now(timezone.utc),
        source_context_ids=[source_id or uuid4()],
    )


def test_build_reasoning_factors_gas_and_occupancy():
    refs = [
        RetrievedReference(
            source="regulations",
            id=REG_ID,
            retrieval_path="deterministic",
            title="Confined Space Atmospheric Testing",
            code="OSHA-1910.146",
            snippet="Gas readings above action levels require evacuation.",
            triggered_by_fact="elevated_gas",
        ),
        RetrievedReference(
            source="historical_incidents",
            id=INC_ID,
            retrieval_path="deterministic",
            title="Historical incident",
            snippet="Near-miss: workers remained in hazardous zone.",
            triggered_by_fact="zone_occupied",
        ),
    ]
    context = [
        {
            "id": str(uuid4()),
            "category": "sensor",
            "payload": {"gas_reading": 25.5, "unit": "ppm"},
        },
        {
            "id": str(uuid4()),
            "category": "worker_location",
            "payload": {
                "worker_id": "55555555-5555-5555-5555-555555555551",
                "worker_name": "Asha Rao",
                "zone": "hazardous",
            },
        },
    ]
    sensor_id = UUID(context[0]["id"])
    owner = AreaOwner(
        worker_id=UUID("55555555-5555-5555-5555-555555555551"),
        name="Asha Rao",
        role="Area Supervisor",
        zone="coke-oven-battery",
    )
    factors = build_reasoning_factors(
        [_fact("elevated_gas", sensor_id), _fact("zone_occupied")],
        context,
        refs,
        asset_name="Vessel A",
        area_owner=owner,
    )
    assert len(factors) == 2
    by_type = {f.fact_type: f for f in factors}
    assert "25.5" in by_type["elevated_gas"].detail
    assert "Vessel A" in by_type["elevated_gas"].detail
    assert by_type["elevated_gas"].evidence[0].code == "OSHA-1910.146"
    assert "Asha Rao" in by_type["zone_occupied"].detail
    assert "Area owner" in by_type["zone_occupied"].detail


def test_build_reasoning_factors_permit_conflict():
    refs = [
        RetrievedReference(
            source="sops",
            id=SOP_ID,
            retrieval_path="deterministic",
            title="SOP-PTW-Conflict Resolution",
            snippet="When two active permits overlap…",
            triggered_by_fact="permit_conflict",
        )
    ]
    context = [
        {
            "id": str(uuid4()),
            "category": "permit",
            "payload": {
                "permit_id": "p-1",
                "status": "active",
                "work_type": "hot_work",
            },
        },
        {
            "id": str(uuid4()),
            "category": "permit",
            "payload": {
                "permit_id": "p-2",
                "status": "active",
                "work_type": "cold_work",
            },
        },
    ]
    factors = build_reasoning_factors(
        [_fact("permit_conflict")],
        context,
        refs,
        asset_name="Vessel A",
    )
    assert len(factors) == 1
    assert "p-1" in factors[0].detail
    assert "p-2" in factors[0].detail
    assert factors[0].evidence[0].title == "SOP-PTW-Conflict Resolution"


def test_critical_gas_suppresses_elevated_and_uses_peak_reading():
    low_id = uuid4()
    high_id = uuid4()
    context = [
        {
            "id": str(low_id),
            "category": "sensor",
            "payload": {"gas_reading": 25.0, "unit": "ppm"},
        },
        {
            "id": str(high_id),
            "category": "sensor",
            "payload": {"gas_reading": 55.0, "unit": "ppm"},
        },
    ]
    factors = build_reasoning_factors(
        [
            _fact("elevated_gas", low_id),
            _fact("critical_gas", high_id),
            _fact("incomplete_isolation"),
        ],
        context,
        [],
        asset_name="Vessel A",
    )
    types = {f.fact_type for f in factors}
    assert "critical_gas" in types
    assert "elevated_gas" not in types
    assert "incomplete_isolation" in types
    critical = next(f for f in factors if f.fact_type == "critical_gas")
    assert "55" in critical.detail
    assert "25" not in critical.detail


def test_empty_facts_yields_empty_factors():
    assert build_reasoning_factors([], [], []) == []
