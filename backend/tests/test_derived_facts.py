from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.context.derived_facts import (
    ContextEntryView,
    evaluate_rules,
    rule_certification_expiring,
    rule_elevated_gas,
    rule_incomplete_isolation,
    rule_permit_conflict,
    rule_simultaneous_ops,
    rule_zone_occupied,
)

ASSET = uuid4()
NOW = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


def _entry(
    category: str,
    payload: dict,
    *,
    hours: float = 4,
) -> ContextEntryView:
    return ContextEntryView(
        id=uuid4(),
        asset_id=ASSET,
        category=category,
        payload=payload,
        provider="test",
        valid_from=NOW - timedelta(minutes=1),
        valid_until=NOW + timedelta(hours=hours),
        confidence=1.0,
    )


def test_elevated_gas_true_and_false():
    over = [_entry("sensor", {"gas_reading": 25.5, "unit": "ppm"})]
    under = [_entry("sensor", {"gas_reading": 10.0, "unit": "ppm"})]
    assert rule_elevated_gas(over, now=NOW, threshold=20.0) is not None
    assert rule_elevated_gas(under, now=NOW, threshold=20.0) is None


def test_permit_conflict_true_and_false():
    one = [_entry("permit", {"permit_id": "p1", "status": "active", "work_type": "hot_work"})]
    two = one + [
        _entry("permit", {"permit_id": "p2", "status": "active", "work_type": "cold_work"})
    ]
    assert rule_permit_conflict(one, now=NOW) is None
    assert rule_permit_conflict(two, now=NOW) is not None


def test_zone_occupied_true_and_false():
    haz = [_entry("worker_location", {"worker_id": "w-1", "zone": "hazardous"})]
    safe = [_entry("worker_location", {"worker_id": "w-1", "zone": "safe"})]
    assert rule_zone_occupied(haz, now=NOW) is not None
    assert rule_zone_occupied(safe, now=NOW) is None


def test_incomplete_isolation_true_and_false():
    permit = _entry(
        "permit",
        {"permit_id": "p-hot", "status": "active", "work_type": "hot_work"},
    )
    confirmed = _entry(
        "isolation_status",
        {"permit_id": "p-hot", "isolation_confirmed": True},
    )
    assert rule_incomplete_isolation([permit], now=NOW) is not None
    assert rule_incomplete_isolation([permit, confirmed], now=NOW) is None


def test_simultaneous_ops_true_and_false():
    compatible = [
        _entry("permit", {"permit_id": "p1", "status": "active", "work_type": "hot_work"}),
        _entry("permit", {"permit_id": "p2", "status": "active", "work_type": "cold_work"}),
    ]
    incompatible = [
        _entry("permit", {"permit_id": "p1", "status": "active", "work_type": "hot_work"}),
        _entry(
            "permit",
            {"permit_id": "p2", "status": "active", "work_type": "confined_space"},
        ),
    ]
    assert rule_simultaneous_ops(compatible, now=NOW) is None
    assert rule_simultaneous_ops(incompatible, now=NOW) is not None


def test_certification_expiring_true_and_false():
    on_site = _entry("worker_location", {"worker_id": "w-1", "zone": "hazardous"})
    expiring = _entry(
        "certification",
        {
            "worker_id": "w-1",
            "name": "gas_testing",
            "expires_at": (NOW + timedelta(days=3)).isoformat(),
        },
    )
    far = _entry(
        "certification",
        {
            "worker_id": "w-1",
            "name": "gas_testing",
            "expires_at": (NOW + timedelta(days=90)).isoformat(),
        },
    )
    assert (
        rule_certification_expiring([on_site, expiring], now=NOW, warning_days=14)
        is not None
    )
    assert (
        rule_certification_expiring([on_site, far], now=NOW, warning_days=14) is None
    )


def test_evaluate_rules_runs_all_six():
    entries = [
        _entry("sensor", {"gas_reading": 30.0}),
        _entry("worker_location", {"worker_id": "w-1", "zone": "hazardous"}),
        _entry("permit", {"permit_id": "p1", "status": "active", "work_type": "hot_work"}),
        _entry(
            "permit",
            {"permit_id": "p2", "status": "active", "work_type": "confined_space"},
        ),
    ]
    result = evaluate_rules(entries, now=NOW)
    assert set(result.keys()) == {
        "elevated_gas",
        "permit_conflict",
        "zone_occupied",
        "incomplete_isolation",
        "simultaneous_ops",
        "certification_expiring",
    }
    assert result["elevated_gas"] is not None
    assert result["zone_occupied"] is not None
    assert result["permit_conflict"] is not None
    assert result["simultaneous_ops"] is not None
    assert result["incomplete_isolation"] is not None
