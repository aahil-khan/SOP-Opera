"""Auto-reopen decided reviews when live risk materially worsens."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from shared.python.schemas import DerivedFact, Review

from app.reviews.service import (
    should_reassess,
    should_reopen_after_decision,
)
from app.reviews.state_machine import ReviewEvent, next_state


def _fact(fact_type: str) -> DerivedFact:
    now = datetime.now(timezone.utc)
    return DerivedFact(
        id=uuid4(),
        asset_id=uuid4(),
        fact_type=fact_type,
        value=True,
        computed_at=now,
        source_context_ids=[],
    )


def test_decided_to_reopened_on_risk_returned():
    assert next_state("decided", ReviewEvent.RISK_RETURNED) == "reopened"


def test_decided_to_reopened_via_manual_reopen():
    assert next_state("decided", ReviewEvent.REOPEN) == "reopened"


def test_should_reassess_closed_when_critical_returns():
    review = Review(
        id=uuid4(),
        asset_id=uuid4(),
        state="closed",
        owner_id=uuid4(),
        triggered_by="elevated_gas",
        created_at=datetime.now(timezone.utc),
    )
    facts = [_fact("elevated_gas"), _fact("critical_gas")]
    assert should_reassess(review, ["critical_gas"], facts) is True


def test_should_not_reassess_closed_on_benign_change():
    review = Review(
        id=uuid4(),
        asset_id=uuid4(),
        state="closed",
        owner_id=uuid4(),
        triggered_by="elevated_gas",
        created_at=datetime.now(timezone.utc),
    )
    facts = [_fact("elevated_gas")]
    assert should_reassess(review, ["elevated_gas"], facts) is False


def test_should_reopen_on_critical_gas():
    facts = [_fact("elevated_gas"), _fact("critical_gas")]
    assert should_reopen_after_decision(["critical_gas"], facts) is True


def test_should_not_reopen_on_second_elevated_fact_only():
    # `permit_conflict` supplies CONTROL_FAILURE only, so with `elevated_gas`
    # the verdict is elevated, not blocking — a decided review stays decided.
    # Deliberately *not* `incomplete_isolation`: that one also supplies
    # IGNITION_ENERGY and so completes the pathway (see the test below).
    facts = [_fact("elevated_gas"), _fact("permit_conflict")]
    assert should_reopen_after_decision(["permit_conflict"], facts) is False


def test_should_reopen_when_isolation_completes_pathway():
    """
    `elevated_gas` + `incomplete_isolation` is a *blocking* pair, not two
    elevated facts.

    `incomplete_isolation` maps to {IGNITION_ENERGY, CONTROL_FAILURE} — an
    isolation that was never confirmed evidences both an energy source and the
    failure of the barrier around it — so with a hazardous atmosphere it
    completes the substance + energy + failed-barrier pathway that
    `classify()` blocks on, with nobody yet present.

    This pins that behaviour. If it starts failing, fix the caller, not the
    dimension mapping in `risk/policy.py`: the mapping is the compound-risk
    claim itself.
    """
    facts = [_fact("elevated_gas"), _fact("incomplete_isolation")]
    assert should_reopen_after_decision(["incomplete_isolation"], facts) is True


def test_should_reopen_when_compound_blocking_forms():
    facts = [
        _fact("elevated_gas"),
        _fact("incomplete_isolation"),
        _fact("zone_occupied"),
    ]
    assert should_reopen_after_decision(["zone_occupied"], facts) is True


def test_should_reassess_decided_when_compound_blocking():
    review = Review(
        id=uuid4(),
        asset_id=uuid4(),
        state="decided",
        owner_id=uuid4(),
        triggered_by="elevated_gas",
        created_at=datetime.now(timezone.utc),
    )
    facts = [
        _fact("elevated_gas"),
        _fact("incomplete_isolation"),
        _fact("zone_occupied"),
    ]
    assert should_reassess(review, ["zone_occupied"], facts) is True


def test_should_not_reassess_decided_on_benign_change():
    review = Review(
        id=uuid4(),
        asset_id=uuid4(),
        state="decided",
        owner_id=uuid4(),
        triggered_by="elevated_gas",
        created_at=datetime.now(timezone.utc),
    )
    facts = [_fact("elevated_gas")]
    assert should_reassess(review, ["elevated_gas"], facts) is False
