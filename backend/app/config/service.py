from __future__ import annotations

from app.config.schemas import RuleThresholds, SensorBandThresholds, ThresholdsConfigOut
from app.core.config import Settings, get_settings


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
