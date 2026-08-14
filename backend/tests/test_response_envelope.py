"""
The reversibility envelope is the whole W1 claim, so it is tested hardest.

Pure logic — no Postgres, no fixtures, runs in milliseconds. Every test here
should survive a database being unreachable.
"""

from __future__ import annotations

import pytest

from app.response.envelope import (
    ACTION_REGISTRY,
    MAX_AUTONOMOUS_TIER,
    PROTECTIVE_STATE,
    ActionSpec,
    actions_for_tier,
    envelope_payload,
    may_execute_autonomously,
)

ZONES = frozenset({"coke-oven-battery"})


def gate(kind: str, *, device_zone: str | None = "coke-oven-battery", zones=ZONES):
    return may_execute_autonomously(
        ACTION_REGISTRY[kind], device_zone=device_zone, affected_zones=zones
    )


# --- Tier 3 is refused in code, not by convention ---------------------------


@pytest.mark.parametrize(
    "kind", ["unit_shutdown", "depressurize", "evacuation_complete"]
)
def test_tier3_is_always_refused(kind: str) -> None:
    verdict = gate(kind, device_zone=None)
    assert verdict.refused
    assert verdict.clauses["tier_permits_automation"] is False
    assert "Tier 3" in verdict.reason


def test_tier3_refused_even_if_zone_would_otherwise_contain_it() -> None:
    """Widening the affected zones must not buy a Tier 3 action any autonomy."""
    verdict = may_execute_autonomously(
        ACTION_REGISTRY["unit_shutdown"],
        device_zone="coke-oven-battery",
        affected_zones=frozenset({"coke-oven-battery", "everywhere"}),
    )
    assert verdict.refused


def test_no_registered_action_above_tier_2_is_ever_allowed() -> None:
    for spec in ACTION_REGISTRY.values():
        if spec.tier > MAX_AUTONOMOUS_TIER:
            verdict = may_execute_autonomously(
                spec, device_zone="coke-oven-battery", affected_zones=ZONES
            )
            assert verdict.refused, f"{spec.kind} escaped the tier clause"


# --- Tier 0-2 pass inside their envelope ------------------------------------


@pytest.mark.parametrize("kind", [s.kind for s in actions_for_tier(1)])
def test_tier1_actions_execute_inside_the_envelope(kind: str) -> None:
    assert gate(kind).allowed


@pytest.mark.parametrize("kind", [s.kind for s in actions_for_tier(2)])
def test_tier2_actions_execute_inside_the_envelope(kind: str) -> None:
    assert gate(kind).allowed


def test_tier0_evidence_needs_no_zone() -> None:
    """Preserving evidence touches nothing physical, so it is never bounded out."""
    verdict = may_execute_autonomously(
        ACTION_REGISTRY["preserve_evidence"],
        device_zone=None,
        affected_zones=frozenset(),
    )
    assert verdict.allowed
    assert verdict.clauses["bounded_blast_radius"] is True


# --- Clause 3 · blast radius -------------------------------------------------


def test_device_outside_the_affected_zone_is_refused() -> None:
    verdict = gate("ventilation_on", device_zone="sinter-plant")
    assert verdict.refused
    assert verdict.clauses["bounded_blast_radius"] is False
    assert "not bounded" in verdict.reason


def test_plant_wide_radius_is_never_bounded() -> None:
    plant_wide = ActionSpec(
        kind="hypothetical",
        tier=2,
        label="Plant-wide something",
        reversible=True,
        blast_radius="plant",
        device_kind="ventilation",
        commanded_state="on",
    )
    verdict = may_execute_autonomously(
        plant_wide, device_zone="coke-oven-battery", affected_zones=ZONES
    )
    assert verdict.refused
    assert verdict.clauses["bounded_blast_radius"] is False


def test_paging_is_bounded_by_having_an_affected_zone_at_all() -> None:
    assert gate("page_response_team", device_zone=None).allowed
    refused = gate("page_response_team", device_zone=None, zones=frozenset())
    assert refused.refused


# --- Clause 2 · fail-safe direction -----------------------------------------


def test_commanding_a_device_away_from_protection_is_refused() -> None:
    """Automation may only make the plant safer; the inverse needs a human."""
    unsafe = ActionSpec(
        kind="ventilation_off",
        tier=2,
        label="Ventilation stopped",
        reversible=True,
        blast_radius="zone",
        device_kind="ventilation",
        commanded_state="off",
    )
    verdict = may_execute_autonomously(
        unsafe, device_zone="coke-oven-battery", affected_zones=ZONES
    )
    assert verdict.refused
    assert verdict.clauses["fail_safe_direction"] is False
    assert "safer" in verdict.reason


def test_every_device_action_commands_its_protective_state() -> None:
    """Guards the registry itself against a typo that would silently disarm W1."""
    for spec in ACTION_REGISTRY.values():
        if spec.device_kind is None or spec.tier > MAX_AUTONOMOUS_TIER:
            continue
        assert spec.commanded_state == PROTECTIVE_STATE[spec.device_kind], (
            f"{spec.kind} does not command its protective state"
        )


# --- Clause 1 · reversibility ------------------------------------------------


def test_irreversible_action_is_refused() -> None:
    irreversible = ActionSpec(
        kind="one_way",
        tier=2,
        label="One-way action",
        reversible=False,
        blast_radius="zone",
        device_kind="ventilation",
        commanded_state="on",
    )
    verdict = may_execute_autonomously(
        irreversible, device_zone="coke-oven-battery", affected_zones=ZONES
    )
    assert verdict.refused
    assert verdict.clauses["reversible"] is False


def test_every_autonomous_action_is_reversible() -> None:
    for spec in ACTION_REGISTRY.values():
        if spec.tier <= MAX_AUTONOMOUS_TIER:
            assert spec.reversible, f"{spec.kind} is automatic but not reversible"
            assert spec.reversal, f"{spec.kind} has no stated reversal mechanism"


# --- Reporting ---------------------------------------------------------------


def test_payload_reports_every_clause_for_a_refusal() -> None:
    spec = ACTION_REGISTRY["unit_shutdown"]
    verdict = may_execute_autonomously(
        spec, device_zone=None, affected_zones=ZONES
    )
    payload = envelope_payload(spec, verdict)
    assert payload["allowed"] is False
    assert payload["tier"] == 3
    assert payload["refusal_reason"]
    # All four clauses reported, so the explainer can show which ones held.
    assert set(payload["clauses"]) == {
        "reversible",
        "fail_safe_direction",
        "bounded_blast_radius",
        "tier_permits_automation",
    }


def test_payload_for_an_allowed_action_carries_no_refusal() -> None:
    spec = ACTION_REGISTRY["ventilation_on"]
    payload = envelope_payload(spec, gate("ventilation_on"))
    assert payload["allowed"] is True
    assert payload["refusal_reason"] is None
    assert payload["reversal"]
