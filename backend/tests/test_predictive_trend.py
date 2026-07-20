from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.agents.nodes.predictive_trend import predictive_trend_agent
from app.assessment.pipeline import _augment_reasoning_with_predictive_trend
from app.assessment.reasoning import format_predicted_trend_detail
from app.core.config import get_settings
from app.context.derived_facts import ContextEntryView
from app.context.lead_time import estimate_seconds_until_gas_critical, forecast_metric

NOW = datetime(2026, 1, 15, 8, 0, tzinfo=timezone.utc)
ASSET = "11111111-1111-1111-1111-111111111111"


def _sensor_view(gas: float, *, sec: int) -> ContextEntryView:
    return ContextEntryView(
        id=uuid4(),
        asset_id=uuid4(),
        category="sensor",
        payload={"gas_reading": gas, "unit": "ppm"},
        provider="test",
        valid_from=NOW + timedelta(seconds=sec),
        valid_until=NOW + timedelta(hours=1),
        confidence=1.0,
    )


def _ctx_entry(gas: float, *, sec: int) -> dict:
    return {
        "id": str(uuid4()),
        "asset_id": ASSET,
        "category": "sensor",
        "payload": {"gas_reading": gas, "unit": "ppm"},
        "provider": "test",
        "valid_from": (NOW + timedelta(seconds=sec)).isoformat(),
        "valid_until": (NOW + timedelta(hours=1)).isoformat(),
        "confidence": 1.0,
    }


def test_forecast_metric_fit_and_eta():
    fc = forecast_metric(
        [
            _sensor_view(20.0, sec=0),
            _sensor_view(26.0, sec=60),
            _sensor_view(32.0, sec=120),
        ],
        field="gas_reading",
        elevated=20.0,
        critical=50.0,
        min_points=3,
    )
    assert fc is not None
    assert fc.trend == "rising"
    assert fc.r_squared > 0.99
    assert 5.8 <= fc.slope_per_min <= 6.2
    assert fc.seconds_to_critical is not None
    assert 170.0 <= fc.seconds_to_critical <= 190.0


def test_gas_critical_wrapper_uses_forecast():
    est = estimate_seconds_until_gas_critical(
        [
            _sensor_view(25.0, sec=0),
            _sensor_view(42.0, sec=16),
        ]
    )
    assert est is not None
    assert 7.0 <= est <= 8.5


@pytest.mark.asyncio
async def test_predictive_trend_agent_emits_risk_observation():
    state = {
        "review_id": str(uuid4()),
        "assessment_id": str(uuid4()),
        "asset_id": ASSET,
        "asset_name": "Vessel A",
        "asset_zone": "z1",
        "fact_types": [],
        "facts": [],
        "context_entries": [
            _ctx_entry(20.0, sec=0),
            _ctx_entry(28.0, sec=60),
            _ctx_entry(37.0, sec=120),
        ],
        "plant_context_entries": [],
        "retrieved_references": [],
        "observations": [],
        "agent_trace": [],
        "spatial_links": [],
        "trend_forecasts": [],
        "incident_echoes": [],
        "shift_handover_note": None,
        "verdict": None,
        "grounded_fact_types": [],
        "provider_name": "mock",
        "llm_usage": [],
        "llm_outcomes": [],
    }
    out = await predictive_trend_agent(state)  # type: ignore[arg-type]
    assert out["observations"][0]["agent"] == "predictive_trend"
    assert out["observations"][0]["local_risk"] == "elevated"
    assert "predicted_trend_risk" in out["observations"][0]["fact_types"]
    assert any(step["agent"] == "predictive_trend" for step in out["agent_trace"])


def test_fuse_risk_nudges_nominal_to_elevated_on_predictive_hit():
    from app.agents.nodes.orchestrator import _fuse_risk

    risk = _fuse_risk(
        [],
        [
            {
                "agent": "predictive_trend",
                "observation": "Gas projected to breach soon.",
                "local_risk": "elevated",
                "fact_types": ["predicted_trend_risk"],
                "detail": {},
            }
        ],
    )
    assert risk == "elevated"


def test_format_predicted_trend_detail_copy():
    detail = format_predicted_trend_detail(
        asset_name="Vessel A",
        metric="gas_reading",
        slope_per_min=7.0,
        r_squared=0.99,
        seconds_to_elevated=30.0,
        seconds_to_critical=180.0,
    )
    assert "Gas rising 7.0/min" in detail
    assert "Vessel A" in detail
    assert "R²=0.99" in detail


def test_augment_reasoning_persists_predicted_trend_risk():
    agent_trace = [
        {
            "agent": "predictive_trend",
            "kind": "observation",
            "finding": "risk",
        },
        {
            "agent": "orchestrator",
            "kind": "verdict",
            "detail": {
                "trend_forecasts": [
                    {
                        "metric": "gas_reading",
                        "slope_per_min": 7.0,
                        "r_squared": 0.99,
                        "seconds_to_elevated": 30.0,
                        "seconds_to_critical": 180.0,
                    }
                ]
            },
        },
    ]
    factors = _augment_reasoning_with_predictive_trend(
        reasoning_factors=[],
        agent_trace=agent_trace,
        asset_name="Vessel A",
        settings=get_settings(),
    )
    assert len(factors) == 1
    assert factors[0].fact_type == "predicted_trend_risk"
    assert factors[0].headline == "Rising sensor trend"
    assert "Vessel A" in factors[0].detail
    assert "gas" in factors[0].detail.lower()


@pytest.mark.asyncio
async def test_predictive_trend_still_fires_when_elevated_gas_grounded():
    state = {
        "review_id": str(uuid4()),
        "assessment_id": str(uuid4()),
        "asset_id": ASSET,
        "asset_name": "Vessel A",
        "asset_zone": "z1",
        "fact_types": ["elevated_gas"],
        "facts": [],
        "context_entries": [
            _ctx_entry(25.0, sec=0),
            _ctx_entry(34.0, sec=60),
            _ctx_entry(42.0, sec=120),
        ],
        "plant_context_entries": [],
        "retrieved_references": [],
        "observations": [],
        "agent_trace": [],
        "spatial_links": [],
        "trend_forecasts": [],
        "incident_echoes": [],
        "shift_handover_note": None,
        "verdict": None,
        "grounded_fact_types": ["elevated_gas"],
        "provider_name": "mock",
        "llm_usage": [],
        "llm_outcomes": [],
    }
    out = await predictive_trend_agent(state)  # type: ignore[arg-type]
    assert out["observations"][0]["local_risk"] == "elevated"
    assert "predicted_trend_risk" in out["observations"][0]["fact_types"]
    assert "critical in" in out["observations"][0]["observation"].lower()


@pytest.mark.asyncio
async def test_predictive_trend_fallback_on_hot_work_and_elevated_gas():
    state = {
        "review_id": str(uuid4()),
        "assessment_id": str(uuid4()),
        "asset_id": ASSET,
        "asset_name": "Vessel A",
        "asset_zone": "z1",
        "fact_types": ["elevated_gas"],
        "facts": [],
        "context_entries": [
            _ctx_entry(25.0, sec=0),
            {
                "id": str(uuid4()),
                "asset_id": ASSET,
                "category": "permit",
                "payload": {
                    "permit_id": "p-hot",
                    "status": "active",
                    "work_type": "hot_work",
                },
                "provider": "test",
                "valid_from": NOW.isoformat(),
                "valid_until": (NOW + timedelta(hours=1)).isoformat(),
                "confidence": 1.0,
            },
        ],
        "plant_context_entries": [],
        "retrieved_references": [],
        "observations": [],
        "agent_trace": [],
        "spatial_links": [],
        "trend_forecasts": [],
        "incident_echoes": [],
        "shift_handover_note": None,
        "verdict": None,
        "grounded_fact_types": ["elevated_gas"],
        "provider_name": "mock",
        "llm_usage": [],
        "llm_outcomes": [],
    }
    out = await predictive_trend_agent(state)  # type: ignore[arg-type]
    assert out["observations"][0]["local_risk"] == "elevated"
    assert "predicted_trend_risk" in out["observations"][0]["fact_types"]
    assert "hot work" in out["observations"][0]["observation"].lower()


def test_augment_reasoning_fallback_when_no_ols_candidate():
    agent_trace = [
        {
            "agent": "predictive_trend",
            "kind": "observation",
            "finding": "risk",
        },
    ]
    factors = _augment_reasoning_with_predictive_trend(
        reasoning_factors=[],
        agent_trace=agent_trace,
        asset_name="Vessel A",
        settings=get_settings(),
    )
    assert len(factors) == 1
    assert "anticipatory forecast" in factors[0].detail.lower()


def test_augment_reasoning_skips_without_predictive_hit():
    agent_trace = [
        {
            "agent": "predictive_trend",
            "kind": "observation",
            "finding": "clearance",
        },
        {
            "agent": "orchestrator",
            "kind": "verdict",
            "detail": {
                "trend_forecasts": [
                    {
                        "metric": "gas_reading",
                        "slope_per_min": 7.0,
                        "r_squared": 0.99,
                        "seconds_to_elevated": 30.0,
                        "seconds_to_critical": 180.0,
                    }
                ]
            },
        },
    ]
    factors = _augment_reasoning_with_predictive_trend(
        reasoning_factors=[],
        agent_trace=agent_trace,
        asset_name="Vessel A",
        settings=get_settings(),
    )
    assert factors == []
