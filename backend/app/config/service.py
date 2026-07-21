from __future__ import annotations

import os

from fastapi import HTTPException

from app.config.schemas import (
    RuleThresholds,
    SensorBandThresholds,
    ThresholdsConfigIn,
    ThresholdsConfigOut,
)
from app.core.config import Settings, get_settings

SENSOR_ENV: dict[str, tuple[str, str]] = {
    "gas_reading": ("GAS_ELEVATED_THRESHOLD", "GAS_CRITICAL_THRESHOLD"),
    "temp_reading": ("TEMP_ELEVATED_THRESHOLD", "TEMP_CRITICAL_THRESHOLD"),
}

RULE_ENV: dict[str, str] = {
    "vibration_anomaly_threshold": "VIBRATION_ANOMALY_THRESHOLD",
    "effluent_ph_min": "EFFLUENT_PH_MIN",
    "effluent_ph_max": "EFFLUENT_PH_MAX",
    "tank_level_high_pct": "TANK_LEVEL_HIGH_PCT",
    "tank_level_low_pct": "TANK_LEVEL_LOW_PCT",
    "weather_wind_hold_ms": "WEATHER_WIND_HOLD_MS",
    "cert_expiry_warning_days": "CERT_EXPIRY_WARNING_DAYS",
}


def build_thresholds_config(settings: Settings | None = None) -> ThresholdsConfigOut:
    s = settings or get_settings()
    return ThresholdsConfigOut(
        sensors={
            "gas_reading": SensorBandThresholds(
                elevated=s.gas_elevated_threshold,
                critical=s.gas_critical_threshold,
            ),
            "temp_reading": SensorBandThresholds(
                elevated=s.temp_elevated_threshold,
                critical=s.temp_critical_threshold,
            ),
        },
        rules=RuleThresholds(
            vibration_anomaly_threshold=s.vibration_anomaly_threshold,
            effluent_ph_min=s.effluent_ph_min,
            effluent_ph_max=s.effluent_ph_max,
            tank_level_high_pct=s.tank_level_high_pct,
            tank_level_low_pct=s.tank_level_low_pct,
            weather_wind_hold_ms=s.weather_wind_hold_ms,
            cert_expiry_warning_days=s.cert_expiry_warning_days,
        ),
    )


def apply_threshold_updates(body: ThresholdsConfigIn) -> ThresholdsConfigOut:
    """Merge patch into process env, clear Settings cache, return effective config."""
    current = build_thresholds_config()

    if body.sensors:
        for metric, patch in body.sensors.items():
            if metric not in SENSOR_ENV:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown sensor metric: {metric}",
                )
            band = current.sensors[metric]
            elevated = patch.elevated if patch.elevated is not None else band.elevated
            critical = patch.critical if patch.critical is not None else band.critical
            if critical <= elevated:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{metric}: critical ({critical}) must be greater than "
                        f"elevated ({elevated})"
                    ),
                )
            elev_env, crit_env = SENSOR_ENV[metric]
            if patch.elevated is not None:
                os.environ[elev_env] = str(patch.elevated)
            if patch.critical is not None:
                os.environ[crit_env] = str(patch.critical)

    if body.rules is not None:
        for field, env_key in RULE_ENV.items():
            value = getattr(body.rules, field)
            if value is not None:
                os.environ[env_key] = str(value)

    get_settings.cache_clear()
    updated = build_thresholds_config()

    # Re-validate merged sensor bands after env write.
    for metric, band in updated.sensors.items():
        if band.critical <= band.elevated:
            raise HTTPException(
                status_code=400,
                detail=f"{metric}: critical must be greater than elevated",
            )
    return updated
