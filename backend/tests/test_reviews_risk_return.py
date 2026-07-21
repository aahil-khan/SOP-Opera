"""Auto-reopen decided reviews when live risk materially worsens."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.reviews.service import (
    should_reopen_after_decision,
    should_reassess,
)
from app.reviews.state_machine import ReviewEvent, next_state
from shared.python.schemas import DerivedFact, Review


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
    facts = [_fact("elevated_gas"), _fact("incomplete_isolation")]
    assert should_reopen_after_decision(["incomplete_isolation"], facts) is False


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
