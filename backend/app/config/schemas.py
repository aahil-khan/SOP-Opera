from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class SensorBandThresholds(BaseModel):
    """Elevated = compound-engine early warning; critical = single-sensor incident line."""

    elevated: float
    critical: float

    @model_validator(mode="after")
    def critical_above_elevated(self) -> SensorBandThresholds:
        if self.critical <= self.elevated:
            raise ValueError("critical must be greater than elevated")
        return self


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


class SensorBandThresholdsPatch(BaseModel):
    elevated: float | None = None
    critical: float | None = None


class RuleThresholdsPatch(BaseModel):
    vibration_anomaly_threshold: float | None = None
    effluent_ph_min: float | None = None
    effluent_ph_max: float | None = None
    tank_level_high_pct: float | None = None
    tank_level_low_pct: float | None = None
    weather_wind_hold_ms: float | None = None
    cert_expiry_warning_days: int | None = Field(default=None, ge=0)


class ThresholdsConfigIn(BaseModel):
    """Partial update for demo threshold tuning (process-local env overrides)."""

    sensors: dict[str, SensorBandThresholdsPatch] | None = None
    rules: RuleThresholdsPatch | None = None
