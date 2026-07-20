from __future__ import annotations

from pydantic import BaseModel, Field


class SensorBandThresholds(BaseModel):
    """Elevated = compound-engine early warning; critical = single-sensor incident line."""

    elevated: float
    critical: float


class RuleThresholds(BaseModel):
    vibration_anomaly_threshold: float
    effluent_ph_min: float
    effluent_ph_max: float
    tank_level_high_pct: float
    tank_level_low_pct: float
    weather_wind_hold_ms: float
    cert_expiry_warning_days: int = Field(ge=0)


class ThresholdsConfigOut(BaseModel):
    """Effective threshold config — sourced from environment / Settings."""

    sensors: dict[str, SensorBandThresholds]
    rules: RuleThresholds
