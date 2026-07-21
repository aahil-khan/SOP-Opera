"""
Prediction lead time — compound alarm vs the single-sensor critical threshold.

Measured in **minutes of plant process time**, taken from each scenario step's
`t_offset_minutes`. It used to be measured by summing `delay_seconds`, which is
simulator playback pacing — that produced an "18 second lead time", a number
describing how fast the demo runs rather than how far ahead of an incident the
system warns.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.context.lead_time import estimate_seconds_until_gas_critical
from app.eval.dataset import scenario_timeline_cases
from app.eval.detectors import compound_alarm, forecast_alarm, single_sensor_alarm

__all__ = [
    "ScenarioLeadTime",
    "compute_scenario_lead_time",
    "estimate_seconds_until_gas_critical",
    "hero_lead_time",
]


@dataclass(frozen=True)
class ScenarioLeadTime:
    scenario: str
    t_forecast_minutes: float | None
    t_compound_minutes: float | None
    t_single_sensor_minutes: float | None
    lead_time_minutes: float | None
    """Single-sensor critical minus compound alarm (positive = compound was earlier)."""

    @property
    def lead_time_seconds(self) -> float | None:
        """Kept for API/back-compat; process seconds, not playback seconds."""
        if self.lead_time_minutes is None:
            return None
        return self.lead_time_minutes * 60.0


def compute_scenario_lead_time(scenario_name: str) -> ScenarioLeadTime:
    cases = scenario_timeline_cases(scenario_name)

    t_compound: float | None = None
    t_single: float | None = None
    t_forecast: float | None = None

    for case in cases:
        entries = list(case.entries)
        at = case.minutes_from_start
        if at is None:
            continue
        if t_forecast is None and forecast_alarm(entries):
            t_forecast = at
        if t_compound is None and compound_alarm(entries):
            t_compound = at
        if t_single is None and single_sensor_alarm(entries):
            t_single = at

    lead: float | None = None
    if t_compound is not None and t_single is not None and t_single > t_compound:
        lead = t_single - t_compound

    return ScenarioLeadTime(
        scenario=scenario_name,
        t_forecast_minutes=t_forecast,
        t_compound_minutes=t_compound,
        t_single_sensor_minutes=t_single,
        lead_time_minutes=lead,
    )


def hero_lead_time() -> ScenarioLeadTime:
    return compute_scenario_lead_time("vsp_coke_oven")
