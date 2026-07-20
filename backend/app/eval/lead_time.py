"""Prediction lead time — compound alarm vs single-sensor critical threshold."""

from __future__ import annotations

from dataclasses import dataclass

from app.context.lead_time import estimate_seconds_until_gas_critical
from app.core.config import get_settings
from app.eval.dataset import scenario_timeline_cases
from app.eval.detectors import compound_alarm, forecast_alarm, single_sensor_alarm
from app.simulator.dsl import ScenarioFile, load_scenario

# Re-export for eval/tests that import from here.
__all__ = [
    "ScenarioLeadTime",
    "compute_scenario_lead_time",
    "estimate_seconds_until_gas_critical",
    "hero_lead_time",
]


@dataclass(frozen=True)
class ScenarioLeadTime:
    scenario: str
    t_forecast_seconds: float | None
    t_compound_seconds: float | None
    t_single_sensor_seconds: float | None
    lead_time_seconds: float | None
    """Single-sensor critical minus compound alarm (positive = compound was earlier)."""


def scenario_cumulative_times(
    scenario: ScenarioFile,
    *,
    default_delay_seconds: float,
) -> list[float]:
    """Wall-clock seconds from scenario start at each step boundary."""
    times: list[float] = []
    elapsed = 0.0
    for step in scenario.steps:
        delay = (
            float(step.delay_seconds)
            if step.delay_seconds is not None
            else default_delay_seconds
        )
        elapsed += delay
        times.append(elapsed)
    return times


def compute_scenario_lead_time(scenario_name: str) -> ScenarioLeadTime:
    settings = get_settings()
    scenario = load_scenario(scenario_name)
    times = scenario_cumulative_times(
        scenario,
        default_delay_seconds=float(settings.simulator_default_step_delay_seconds),
    )
    cases = scenario_timeline_cases(scenario_name)

    t_compound: float | None = None
    t_single: float | None = None
    t_forecast: float | None = None
    for case, t in zip(cases, times, strict=True):
        entries = list(case.entries)
        if t_forecast is None and forecast_alarm(entries):
            t_forecast = t
        if t_compound is None and compound_alarm(entries):
            t_compound = t
        if t_single is None and single_sensor_alarm(entries):
            t_single = t

    lead: float | None = None
    if (
        t_compound is not None
        and t_single is not None
        and t_single > t_compound
    ):
        lead = t_single - t_compound

    return ScenarioLeadTime(
        scenario=scenario_name,
        t_forecast_seconds=t_forecast,
        t_compound_seconds=t_compound,
        t_single_sensor_seconds=t_single,
        lead_time_seconds=lead,
    )


def hero_lead_time() -> ScenarioLeadTime:
    return compute_scenario_lead_time("vsp_coke_oven")
