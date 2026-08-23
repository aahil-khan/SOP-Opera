"""What each asset is actually instrumented for.

A plant does not fit every asset with the same sensors: a muster point has no
process instrumentation at all, an effluent plant measures pH, a compressor
measures vibration. `assets.sensor_kinds` records that per asset and the
simulators read it here, so the ambient feed and the random engine agree on
which readings an asset can physically produce.

The kind catalog is closed on purpose. Every kind below is consumed by a
`rule_*` function in `context/derived_facts.py`; a kind no rule reads would be
inert noise on the twin and invisible to the eval harness.
"""

from __future__ import annotations

import json
import random
from typing import Any

# kind -> sub-threshold sample fragment, and the rule that consumes it.
SENSOR_KIND_PAYLOAD: dict[str, Any] = {
    # rule_elevated_gas / rule_critical_gas
    "gas": lambda rng, s: {
        "gas_reading": round(
            rng.uniform(0.5, max(1.0, float(s.gas_elevated_threshold) - 2.0)), 1
        )
    },
    # rule_over_temperature / rule_critical_temperature
    "temp": lambda rng, s: {
        "temp_reading": round(
            rng.uniform(
                min(28.0, float(s.temp_elevated_threshold) - 5.0),
                float(s.temp_elevated_threshold) - 5.0,
            ),
            1,
        )
    },
    # rule_equipment_vibration_anomaly
    "vibration": lambda rng, s: {
        "vibration_mm_s": round(
            rng.uniform(0.2, max(0.5, float(s.vibration_anomaly_threshold) - 0.5)), 2
        )
    },
    # rule_tank_level_critical
    "level": lambda rng, s: {
        "level_pct": round(
            rng.uniform(
                float(s.tank_level_low_pct) + 5.0,
                float(s.tank_level_high_pct) - 5.0,
            ),
            1,
        )
    },
    # rule_effluent_quality_breach
    "ph": lambda rng, s: {
        "ph": round(
            rng.uniform(float(s.effluent_ph_min) + 0.3, float(s.effluent_ph_max) - 0.3),
            2,
        )
    },
    # rule_weather_hold — plant-wide rather than asset-mounted, so it is never
    # part of an asset's sensor_kinds; the heartbeat uses it as a fallback.
    "wind": lambda rng, s: {
        "wind_ms": round(
            rng.uniform(0.5, max(1.0, float(s.weather_wind_hold_ms) - 2.0)), 1
        ),
        "lightning": False,
    },
}

ALL_SENSOR_KINDS: tuple[str, ...] = tuple(SENSOR_KIND_PAYLOAD)

# Fallback for an asset row that predates the `sensor_kinds` column (NULL).
# An explicit `[]` means the asset genuinely carries no process instrumentation
# and must stay silent — the two cases are not the same, so don't collapse them.
DEFAULT_SENSOR_KINDS: tuple[str, ...] = ("gas", "temp", "vibration", "level")

UNIT_BY_KIND: dict[str, str] = {"gas": "ppm", "temp": "C"}


def resolve_sensor_kinds(kinds: list[str] | None) -> list[str]:
    """NULL → legacy default set; [] → genuinely uninstrumented."""
    if kinds is None:
        return list(DEFAULT_SENSOR_KINDS)
    return [k for k in kinds if k in SENSOR_KIND_PAYLOAD]


def parse_sensor_kinds(raw: Any) -> list[str] | None:
    """JSONB arrives as `str` under asyncpg; NULL must stay None."""
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return None
    if isinstance(raw, list):
        return [str(k) for k in raw]
    return None


def sample_kind(
    kind: str, rng: random.Random, settings: Any
) -> dict[str, Any]:
    """One sub-threshold reading for `kind`, with its unit where it has one."""
    payload = dict(SENSOR_KIND_PAYLOAD[kind](rng, settings))
    if kind in UNIT_BY_KIND:
        payload["unit"] = UNIT_BY_KIND[kind]
    return payload
