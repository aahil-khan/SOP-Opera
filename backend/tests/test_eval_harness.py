"""Compound vs single-sensor evaluation harness."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.context.derived_facts import ContextEntryView
from app.eval.dataset import build_dataset, hero_checkpoint, static_cases
from app.eval.detectors import compound_alarm, forecast_alarm, single_sensor_alarm
from app.context.lead_time import (
    compute_lead_time_for_verdict,
    estimate_seconds_until_gas_critical,
)
from app.eval.lead_time import (
    compute_scenario_lead_time,
    hero_lead_time,
)
from app.eval.metrics import run_evaluation

ASSET = uuid4()
NOW = datetime(2026, 1, 15, 8, 0, tzinfo=timezone.utc)


def _gas_entry(reading: float, *, offset_seconds: float) -> ContextEntryView:
    return ContextEntryView(
        id=uuid4(),
        asset_id=ASSET,
        category="sensor",
        payload={"gas_reading": reading, "unit": "ppm"},
        provider="test",
        valid_from=NOW + timedelta(seconds=offset_seconds),
        valid_until=NOW + timedelta(hours=4),
        confidence=1.0,
    )


def test_hero_checkpoint_compound_catches_single_misses():
    hero = hero_checkpoint()
    entries = list(hero.entries)
    assert hero.dangerous is True
    assert compound_alarm(entries) is True
    assert single_sensor_alarm(entries) is False


def test_vsp_pattern_static_case():
    case = next(c for c in static_cases() if c.case_id == "vsp_pattern_subcritical")
    entries = list(case.entries)
    assert compound_alarm(entries) is True
    assert single_sensor_alarm(entries) is False


def test_critical_gas_both_alarm():
    case = next(c for c in static_cases() if c.case_id == "critical_gas_only")
    entries = list(case.entries)
    assert compound_alarm(entries) is True
    assert single_sensor_alarm(entries) is True


def test_elevated_only_neither_blocks_at_critical_line():
    case = next(c for c in static_cases() if c.case_id == "elevated_gas_only")
    entries = list(case.entries)
    assert single_sensor_alarm(entries) is False
    assert compound_alarm(entries) is False


def test_compound_fn_rate_beats_single_sensor_baseline():
    report = run_evaluation()
    assert report.compound.false_negative_rate < report.single_sensor.false_negative_rate
    assert report.fn_reduction_pct > 0
    assert report.compound.recall > report.single_sensor.recall
    assert report.forecast.name == "Predictive forecast (ML trend)"
    assert report.forecast.tp >= 1


def test_vsp_timeline_fn_only_on_subcritical_steps():
    report = run_evaluation()
    by_id = {r.case_id: r for r in report.case_results}

    # Steps 0–1: not yet dangerous (compound hasn't blocked)
    assert by_id["vsp_coke_oven_step0"].dangerous is False
    assert by_id["vsp_coke_oven_step1"].dangerous is False

    # Step 2+: dangerous; compound catches, single-sensor silent until gas critical
    for step_id in ("vsp_coke_oven_step2", "vsp_coke_oven_step3"):
        r = by_id[step_id]
        assert r.dangerous is True
        assert r.compound_alarm is True
        assert r.single_alarm is False
        assert r.compound_only_catch is True

    # Final step: gas critical — both alarm
    final = by_id["vsp_coke_oven_step4"]
    assert final.dangerous is True
    assert final.compound_alarm is True
    assert final.single_alarm is True
    assert final.compound_only_catch is False


def test_dataset_has_expected_cases():
    cases = build_dataset()
    ids = {c.case_id for c in cases}
    assert "vsp_coke_oven_step2" in ids
    assert "vsp_pattern_subcritical" in ids
    assert len(cases) >= 10


def test_vsp_hero_lead_time_from_scenario_delays():
    lt = hero_lead_time()
    assert lt.t_forecast_seconds is not None
    assert lt.t_forecast_seconds <= lt.t_single_sensor_seconds
    assert lt.t_forecast_seconds <= lt.t_compound_seconds
    assert lt.t_compound_seconds == 8.0
    assert lt.t_single_sensor_seconds == 26.0
    assert lt.lead_time_seconds == 18.0


def test_estimate_seconds_until_gas_critical_from_trend():
    entries = [
        _gas_entry(25.0, offset_seconds=0),
        _gas_entry(42.0, offset_seconds=16),
    ]
    # Rate 17/16 ppm/s → (50-42) / rate ≈ 7.5s
    est = estimate_seconds_until_gas_critical(entries)
    assert est is not None
    assert 7.0 <= est <= 8.5


def test_compute_lead_time_for_verdict_blocking_subcritical():
    context = [
        {
            "id": str(uuid4()),
            "asset_id": str(ASSET),
            "category": "sensor",
            "payload": {"gas_reading": 25.0, "unit": "ppm"},
            "provider": "test",
            "valid_from": NOW.isoformat(),
            "valid_until": (NOW + timedelta(hours=4)).isoformat(),
            "confidence": 1.0,
        }
    ]
    assert (
        compute_lead_time_for_verdict(
            context,
            ["elevated_gas", "incomplete_isolation", "zone_occupied"],
            "blocking",
        )
        is None
    )


def test_compute_lead_time_for_verdict_zero_when_critical():
    context = [
        {
            "id": str(uuid4()),
            "asset_id": str(ASSET),
            "category": "sensor",
            "payload": {"gas_reading": 55.0, "unit": "ppm"},
            "provider": "test",
            "valid_from": NOW.isoformat(),
            "valid_until": (NOW + timedelta(hours=4)).isoformat(),
            "confidence": 1.0,
        }
    ]
    assert (
        compute_lead_time_for_verdict(context, ["critical_gas"], "blocking") == 0.0
    )


def test_report_includes_lead_time_section():
    report = run_evaluation()
    assert report.hero_lead_time is not None
    assert report.hero_lead_time.lead_time_seconds == 18.0
    md = report.to_markdown()
    assert "Prediction lead time" in md
    assert "Predictive forecast (ML trend)" in md
    assert "18s lead time" in md


def test_forecast_alarm_fires_on_rising_subcritical_signal():
    entries = [
        _gas_entry(20.0, offset_seconds=0),
        _gas_entry(28.0, offset_seconds=60),
        _gas_entry(37.0, offset_seconds=120),
    ]
    assert forecast_alarm(entries) is True


def test_build_eval_summary_matches_report_headlines():
    from app.eval.service import build_eval_summary

    summary = build_eval_summary()
    assert summary.fn_reduction_pct == 100.0
    assert summary.compound.false_negative_rate == 0.0
    assert summary.single_sensor.false_negative_rate > 0.5
    assert summary.hero_lead_time_seconds == 18.0
    assert summary.case_count > 0
    assert summary.compound_only_catch_count > 0
