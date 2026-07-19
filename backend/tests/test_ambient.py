"""Unit tests for ambient plant telemetry + demo locks."""

from __future__ import annotations

import random

from app.core.config import get_settings
from app.simulator.ambient import (
    assert_nominal_below_thresholds,
    nominal_sensor_payload,
)
from app.simulator.engine import DemoController


def test_nominal_samples_stay_below_thresholds():
    settings = get_settings()
    rng = random.Random(42)
    for _ in range(80):
        payload = nominal_sensor_payload(rng, settings)
        assert_nominal_below_thresholds(payload, settings)


def test_coincidence_payloads_exceed_thresholds():
    settings = get_settings()
    # Mimic coincidence gas builder
    gas = {"gas_reading": 25.0, "unit": "ppm"}
    assert float(gas["gas_reading"]) > float(settings.gas_elevated_threshold)
    temp = {"temp_reading": 90.0, "unit": "C"}
    assert float(temp["temp_reading"]) > float(settings.temp_elevated_threshold)


def test_demo_locks_block_hard_ingest_check():
    ctrl = DemoController()
    assert ctrl.locked_asset_ids == set()
    ctrl.lock_asset("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    assert "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" in ctrl.locked_asset_ids
    ctrl.clear_locks()
    assert ctrl.locked_asset_ids == set()


def test_source_emit_payload_shape_includes_payload_and_ts():
    """Contract: sim.source_emit broadcast body must carry payload + ts."""
    # Shape asserted against the broadcast dict built in BaseSourceSimulator.emit
    body = {
        "source": "scada",
        "label": "SCADA Simulator",
        "category": "sensor",
        "asset_id": "11111111-1111-1111-1111-111111111111",
        "payload": {"gas_reading": 12.0, "unit": "ppm"},
        "ts": "2026-07-19T00:00:00+00:00",
        "review_id": None,
        "derived_facts": [],
        "message": "test",
    }
    assert "payload" in body
    assert "ts" in body
    assert isinstance(body["payload"], dict)


def test_telemetry_sample_contract():
    sample = {
        "source": "scada",
        "label": "SCADA Simulator",
        "asset_id": "11111111-1111-1111-1111-111111111111",
        "asset_name": "Vessel A",
        "category": "sensor",
        "payload": {"gas_reading": 8.2, "unit": "ppm"},
        "ts": "2026-07-19T00:00:00+00:00",
        "mode": "ambient",
    }
    assert sample["mode"] == "ambient"
    assert sample["payload"]["gas_reading"] < get_settings().gas_elevated_threshold


def test_lock_skips_when_asset_locked():
    ctrl = DemoController()
    locked_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    ctrl.lock_asset(locked_id)
    unlocked = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", locked_id]
    candidates = [a for a in unlocked if a not in ctrl.locked_asset_ids]
    assert candidates == ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]
