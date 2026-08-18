"""W3a "blind, not safe" — pure rule + coverage classification (no DB)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.context.coverage import classify_coverage
from app.context.derived_facts import (
    DERIVED_FACT_RULES,
    ContextEntryView,
    rule_sensor_unreliable,
)
from app.risk.policy import classify

NOW = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)
ASSET = uuid4()


def _entry(category: str, payload: dict, *, confidence: float = 1.0, at=NOW):
    return ContextEntryView(
        id=uuid4(),
        asset_id=ASSET,
        category=category,
        payload=payload,
        provider="test",
        valid_from=at,
        valid_until=at + timedelta(hours=4),
        confidence=confidence,
    )


def test_rule_fires_on_low_confidence():
    e = _entry("sensor", {"gas_reading": 5.0}, confidence=0.2)
    fact = rule_sensor_unreliable([e], now=NOW, confidence_floor=0.5)
    assert fact is not None
    assert fact.fact_type == "sensor_unreliable"
    assert fact.source_context_ids == [e.id]


def test_rule_fires_on_fault_payload():
    assert rule_sensor_unreliable(
        [_entry("sensor", {"fault": True})], now=NOW, confidence_floor=0.5
    ) is not None
    assert rule_sensor_unreliable(
        [_entry("sensor", {"status": "fault"})], now=NOW, confidence_floor=0.5
    ) is not None


def test_rule_silent_on_healthy_sensor_and_non_sensor_entries():
    healthy = _entry("sensor", {"gas_reading": 5.0}, confidence=0.9)
    permit = _entry("permit", {"status": "active"}, confidence=0.1)
    assert rule_sensor_unreliable([healthy, permit], now=NOW, confidence_floor=0.5) is None


def test_rule_is_not_registered_and_cannot_change_a_verdict():
    """I5/I7: coverage never enters the risk policy's grounding set."""
    assert "sensor_unreliable" not in {name for name, _ in DERIVED_FACT_RULES}
    verdict = classify(["sensor_unreliable"])
    assert verdict.level == "nominal"
    assert verdict.grounded_facts == ()


def test_coverage_blind_when_no_sensor_ever():
    state, reason = classify_coverage(
        valid_entries=[], last_sensor_seen=None, now=NOW, stale_after_seconds=180
    )
    assert state == "blind"
    assert "ever" in reason


def test_coverage_blind_when_stale():
    state, reason = classify_coverage(
        valid_entries=[],
        last_sensor_seen=NOW - timedelta(seconds=181),
        now=NOW,
        stale_after_seconds=180,
    )
    assert state == "blind"
    assert "absence of data" in reason


def test_coverage_degraded_on_self_reported_fault():
    e = _entry("sensor", {"gas_reading": 5.0}, confidence=0.1)
    state, _ = classify_coverage(
        valid_entries=[e],
        last_sensor_seen=NOW - timedelta(seconds=10),
        now=NOW,
        stale_after_seconds=180,
    )
    assert state == "degraded"


def test_coverage_assessed_when_fresh_and_healthy():
    e = _entry("sensor", {"gas_reading": 5.0}, confidence=0.95)
    state, _ = classify_coverage(
        valid_entries=[e],
        last_sensor_seen=NOW - timedelta(seconds=10),
        now=NOW,
        stale_after_seconds=180,
    )
    assert state == "assessed"


def test_staleness_beats_degraded():
    """Blind (no data) outranks degraded (bad data) — silence hides everything."""
    e = _entry("sensor", {"fault": True})
    state, _ = classify_coverage(
        valid_entries=[e],
        last_sensor_seen=NOW - timedelta(seconds=600),
        now=NOW,
        stale_after_seconds=180,
    )
    assert state == "blind"
