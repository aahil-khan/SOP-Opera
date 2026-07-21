from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.context.derived_facts import (
    ContextEntryView,
    DERIVED_FACT_RULES,
    evaluate_rules,
    rule_certification_expiring,
    rule_critical_gas,
    rule_critical_temperature,
    rule_effluent_quality_breach,
    rule_elevated_gas,
    rule_equipment_vibration_anomaly,
    rule_incomplete_isolation,
    rule_lifting_operation_conflict,
    rule_over_temperature,
    rule_permit_conflict,
    rule_ppe_noncompliance,
    rule_simultaneous_ops,
    rule_tank_level_critical,
    rule_weather_hold,
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


def test_critical_gas_true_and_false():
    critical = [_entry("sensor", {"gas_reading": 55.0, "unit": "ppm"})]
    elevated_only = [_entry("sensor", {"gas_reading": 25.0, "unit": "ppm"})]
    assert rule_critical_gas(critical, now=NOW, threshold=50.0) is not None
    assert rule_critical_gas(elevated_only, now=NOW, threshold=50.0) is None


def test_critical_temperature_true_and_false():
    critical = [_entry("sensor", {"temp_reading": 125.0, "unit": "C"})]
    elevated_only = [_entry("sensor", {"temp_reading": 90.0, "unit": "C"})]
    assert rule_critical_temperature(critical, now=NOW, threshold=120.0) is not None
    assert rule_critical_temperature(elevated_only, now=NOW, threshold=120.0) is None


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


def test_evaluate_rules_runs_every_registered_rule():
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
    # Derive the expected count from the registry rather than hardcoding it —
    # this asserted 15 while 16 rules were registered, so it had been failing
    # silently since whichever rule was added last.
    assert set(result.keys()) == {name for name, _ in DERIVED_FACT_RULES}
    assert len(result) == len(DERIVED_FACT_RULES)
    assert result["elevated_gas"] is not None
    assert result["zone_occupied"] is not None
    assert result["permit_conflict"] is not None
    assert result["simultaneous_ops"] is not None
    assert result["incomplete_isolation"] is not None


def test_over_temperature_true_and_false():
    over = [_entry("sensor", {"temp_reading": 95.0, "unit": "C"})]
    under = [_entry("sensor", {"temp_reading": 60.0, "unit": "C"})]
    assert rule_over_temperature(over, now=NOW, threshold=80.0) is not None
    assert rule_over_temperature(under, now=NOW, threshold=80.0) is None


def test_equipment_vibration_anomaly_true_and_false():
    bad = [_entry("sensor", {"vibration_mm_s": 9.5})]
    ok = [_entry("sensor", {"vibration_mm_s": 3.0})]
    assert rule_equipment_vibration_anomaly(bad, now=NOW, threshold=7.1) is not None
    assert rule_equipment_vibration_anomaly(ok, now=NOW, threshold=7.1) is None


def test_effluent_quality_breach_true_and_false():
    low = [_entry("sensor", {"ph": 4.5})]
    high = [_entry("sensor", {"ph": 10.2})]
    ok = [_entry("sensor", {"ph": 7.2})]
    assert rule_effluent_quality_breach(low, now=NOW) is not None
    assert rule_effluent_quality_breach(high, now=NOW) is not None
    assert rule_effluent_quality_breach(ok, now=NOW) is None


def test_tank_level_critical_true_and_false():
    high = [_entry("sensor", {"level_pct": 97.0})]
    low = [_entry("sensor", {"level_pct": 2.0})]
    ok = [_entry("sensor", {"level_pct": 55.0})]
    assert rule_tank_level_critical(high, now=NOW) is not None
    assert rule_tank_level_critical(low, now=NOW) is not None
    assert rule_tank_level_critical(ok, now=NOW) is None


def test_ppe_noncompliance_true_and_false():
    bad = [_entry("ppe_status", {"worker_id": "w-1", "compliant": False})]
    ok = [_entry("ppe_status", {"worker_id": "w-1", "compliant": True})]
    assert rule_ppe_noncompliance(bad, now=NOW) is not None
    assert rule_ppe_noncompliance(ok, now=NOW) is None


def test_lifting_operation_conflict_true_and_false():
    one = [_entry("lift_plan", {"lift_id": "L1", "status": "active"})]
    two = one + [_entry("lift_plan", {"lift_id": "L2", "status": "active"})]
    assert rule_lifting_operation_conflict(one, now=NOW) is None
    assert rule_lifting_operation_conflict(two, now=NOW) is not None


def test_weather_hold_true_and_false():
    weather = _entry("weather", {"wind_ms": 18.0, "lightning": False})
    hot = _entry(
        "permit",
        {"permit_id": "p1", "status": "active", "work_type": "hot_work"},
    )
    calm = _entry("weather", {"wind_ms": 5.0, "lightning": False})
    assert rule_weather_hold([weather, hot], now=NOW, wind_threshold=15.0) is not None
    assert rule_weather_hold([weather], now=NOW, wind_threshold=15.0) is None
    assert rule_weather_hold([calm, hot], now=NOW, wind_threshold=15.0) is None
    lightning = _entry("weather", {"wind_ms": 2.0, "lightning": True})
    lift = _entry("lift_plan", {"lift_id": "L1", "status": "active"})
    assert rule_weather_hold([lightning, lift], now=NOW) is not None
