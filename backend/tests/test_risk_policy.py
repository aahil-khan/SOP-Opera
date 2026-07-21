"""Truth table for the compound-risk policy — pure logic, no DB."""

from __future__ import annotations

import pytest

from app.risk.policy import (
    ATMOSPHERE,
    CONTROL_FAILURE,
    EXPOSURE,
    IGNITION_ENERGY,
    classify,
    dimensions_for,
    is_blocking_compound,
)


def _spatial(risk: str = "blocking") -> dict:
    return {"agent": "spatial", "local_risk": risk, "fact_types": ["spatial_cooccurrence"]}


def _trend(risk: str = "elevated") -> dict:
    return {
        "agent": "predictive_trend",
        "local_risk": risk,
        "fact_types": ["predicted_trend_risk"],
    }


# --- The headline claim -----------------------------------------------------


def test_vsp_hero_blocks_while_gas_is_subcritical():
    """The whole pitch: compound blocks with no critical sensor fact present."""
    v = classify(["elevated_gas", "incomplete_isolation", "zone_occupied"])
    assert v.is_blocking
    assert v.triggered_rule == "pathway_atmosphere_ignition_control"
    assert "critical_gas" not in v.grounded_facts
    assert set(v.dimensions) == {ATMOSPHERE, IGNITION_ENERGY, EXPOSURE, CONTROL_FAILURE}


def test_compound_trio_blocks_via_exposure_pathway():
    v = classify(["elevated_gas", "permit_conflict", "zone_occupied"])
    assert v.is_blocking


def test_personnel_in_a_hazardous_atmosphere_blocks_without_an_ignition_source():
    """Factories Act s.41B: no worker stays in a hazardous zone during abnormal
    process conditions. Gassing needs no ignition source."""
    v = classify(["elevated_gas", "zone_occupied"])
    assert v.is_blocking
    assert v.triggered_rule == "pathway_atmosphere_exposure"


def test_incompatible_simultaneous_operations_block_on_their_own():
    """Hot work concurrent with confined-space entry is a stop condition
    regardless of the current atmosphere."""
    v = classify(["simultaneous_ops"])
    assert v.is_blocking
    assert v.triggered_rule == "incompatible_simultaneous_operations"


# --- What the old fact-counter got wrong ------------------------------------


def test_three_unrelated_facts_no_longer_block():
    """weather_hold + cert_expiring + ppe gap tripped `len(facts) >= 3` before."""
    v = classify(["weather_hold", "certification_expiring", "ppe_noncompliance"])
    assert v.level == "elevated"
    assert set(v.dimensions) == {CONTROL_FAILURE, EXPOSURE}


def test_three_facts_from_one_dimension_do_not_block():
    v = classify(["permit_conflict", "certification_expiring", "weather_hold"])
    assert v.level == "elevated"
    assert set(v.dimensions) == {CONTROL_FAILURE}


def test_supervisor_report_no_longer_downgrades_a_real_pathway():
    """The old ladder returned `elevated` for any supervisor fact, short-circuiting
    the compound check below it."""
    v = classify(
        [
            "supervisor_equipment_issue",
            "elevated_gas",
            "incomplete_isolation",
            "zone_occupied",
        ]
    )
    assert v.is_blocking


# --- Baseline and grounding -------------------------------------------------


@pytest.mark.parametrize("fact", ["critical_gas", "critical_temperature"])
def test_critical_sensor_fact_alone_blocks(fact):
    v = classify([fact])
    assert v.is_blocking
    assert v.triggered_rule == "single_sensor_critical"


def test_supervisor_safety_hazard_blocks():
    v = classify(["supervisor_safety_hazard"])
    assert v.is_blocking
    assert v.triggered_rule == "supervisor_safety_hazard"


def test_elevated_gas_alone_is_elevated_not_blocking():
    assert classify(["elevated_gas"]).level == "elevated"


def test_nothing_is_nominal():
    v = classify([])
    assert v.level == "nominal"
    assert v.grounded_facts == ()


# --- Non-grounding signals --------------------------------------------------


def test_trend_alone_cannot_ground_a_block():
    """An OLS projection may warn, but never blocks work on its own."""
    v = classify(["predicted_trend_risk"], [_trend()])
    assert v.level == "elevated"
    assert "predicted_trend_risk" not in v.grounded_facts


def test_spatial_alone_cannot_ground_a_block():
    v = classify(["spatial_cooccurrence"], [_spatial()])
    assert v.level != "blocking"
    assert v.grounded_facts == ()


def test_trend_cannot_complete_a_pathway():
    """Previously `predicted_trend_risk` counted toward the >=3 gate."""
    v = classify(["elevated_gas", "predicted_trend_risk"], [_trend()])
    assert v.level == "elevated"


def test_spatial_strengthens_a_grounded_atmosphere_hazard():
    """Gas plus a permit conflict is elevated on its own; geometry placing the
    two together completes the pathway."""
    facts = ["elevated_gas", "permit_conflict"]
    assert classify(facts).level == "elevated"

    v = classify(facts, [_spatial()])
    assert v.is_blocking
    assert v.triggered_rule == "spatial_proximity_pathway"
    assert "spatial_cooccurrence" in v.signals


# --- Invariants -------------------------------------------------------------


def test_blocking_always_carries_grounding():
    """No verdict may block without a deterministic rule fact behind it."""
    cases = [
        (["elevated_gas", "incomplete_isolation", "zone_occupied"], []),
        (["critical_gas"], []),
        (["spatial_cooccurrence"], [_spatial()]),
        (["predicted_trend_risk"], [_trend()]),
        ([], [{"agent": "incident_pattern", "local_risk": "blocking"}]),
    ]
    for facts, obs in cases:
        v = classify(facts, obs)
        if v.is_blocking:
            assert v.grounded_facts, f"ungrounded block for {facts}"


def test_every_rule_fact_maps_to_a_dimension():
    """A fact with no hazard dimension is invisible to the pathway model."""
    from app.risk.policy import ALL_RULE_FACT_TYPES, FACT_DIMENSIONS

    unmapped = {
        f
        for f in ALL_RULE_FACT_TYPES
        if f not in FACT_DIMENSIONS
        # supervisor_floor_report routes through the supervisor branch, not dimensions
        and not f.startswith("supervisor")
    }
    assert not unmapped, f"rule facts missing a hazard dimension: {unmapped}"


def test_dimensions_for_is_additive():
    assert dimensions_for(["incomplete_isolation"]) == {IGNITION_ENERGY, CONTROL_FAILURE}
    assert dimensions_for([]) == set()


def test_is_blocking_compound_matches_classify():
    facts = ["elevated_gas", "incomplete_isolation", "zone_occupied"]
    assert is_blocking_compound(facts) is classify(facts).is_blocking


# --- Threshold boundaries ---------------------------------------------------
#
# An off-by-one between the rule engine and the statutory criteria is invisible
# unless something samples exactly on the threshold. One was hiding here:
# `rule_elevated_gas` used `>` while `rule_critical_gas` and the ground truth
# used `>=`, so gas at exactly the action level with personnel present was a
# silent false negative.


def test_elevated_and_critical_rules_agree_on_at_or_above():
    """Both bands must treat the threshold itself as inside the band."""
    import inspect

    from app.context import derived_facts as df

    for fn in (df.rule_elevated_gas, df.rule_critical_gas,
               df.rule_over_temperature, df.rule_critical_temperature):
        src = inspect.getsource(fn)
        assert ">= threshold" in src, (
            f"{fn.__name__} does not use >= on its threshold; a reading exactly "
            "on the action level would be missed"
        )


def test_detector_catches_every_statutory_case_at_the_exact_threshold():
    """No stop-work case may be missed because a reading sits on the boundary."""
    from datetime import datetime, timedelta, timezone
    from uuid import UUID, uuid4

    from app.context.derived_facts import ContextEntryView
    from app.core.config import get_settings
    from app.eval.detectors import compound_alarm
    from app.eval.hazard_ground_truth import label

    s = get_settings()
    now = datetime(2026, 1, 15, 8, tzinfo=timezone.utc)
    asset = UUID(int=1)

    def entry(category, payload):
        return ContextEntryView(
            uuid4(), asset, category, payload, "test",
            now, now + timedelta(hours=4), 1.0,
        )

    worker = entry("worker_location", {"worker_id": "w", "zone": "hazardous"})
    for level in (s.gas_elevated_threshold, s.gas_critical_threshold):
        for extra in ([], [worker]):
            entries = [entry("sensor", {"gas_reading": float(level)})] + extra
            if label(entries).dangerous:
                assert compound_alarm(entries), (
                    f"missed a stop-work case at exactly {level} ppm "
                    f"(worker present: {bool(extra)})"
                )
