"""Labeled evaluation snapshots — static cases + scenario timeline replay."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from app.context.derived_facts import ContextEntryView
from app.simulator.dsl import ScenarioFile, ScenarioStep, load_scenario

EVAL_ASSET = UUID("11111111-1111-1111-1111-111111111111")
NOW = datetime(2026, 1, 15, 8, 0, tzinfo=timezone.utc)


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    label: str
    entries: tuple[ContextEntryView, ...]
    dangerous: bool
    """Ground truth: a blocking-level intervention was warranted."""
    scenario: str | None = None
    step_index: int | None = None


def _entry(
    category: str,
    payload: dict,
    *,
    asset_id: UUID = EVAL_ASSET,
) -> ContextEntryView:
    return ContextEntryView(
        id=uuid4(),
        asset_id=asset_id,
        category=category,
        payload=payload,
        provider="eval",
        valid_from=NOW - timedelta(minutes=1),
        valid_until=NOW + timedelta(hours=4),
        confidence=1.0,
    )


def _step_to_entry(step: ScenarioStep, asset_id: UUID = EVAL_ASSET) -> ContextEntryView:
    return _entry(step.category, dict(step.payload), asset_id=asset_id)


def _dangerous_at_step(scenario_name: str, step_index: int) -> bool:
    """When compound fusion should reach blocking before single-sensor critical."""
    if scenario_name == "vsp_coke_oven":
        # Worker entry (step 2) completes the third grounded fact while gas < critical.
        return step_index >= 2
    if scenario_name == "compound_risk":
        # Second overlapping permit (step 3) completes the compound trio.
        return step_index >= 3
    if scenario_name in ("gas_leak", "permit_conflict", "spatial_proximity"):
        return False
    return False


def scenario_timeline_cases(scenario_name: str) -> list[EvalCase]:
    scenario = load_scenario(scenario_name)
    cumulative: list[ContextEntryView] = []
    cases: list[EvalCase] = []
    for i, step in enumerate(scenario.steps):
        cumulative.append(_step_to_entry(step))
        cases.append(
            EvalCase(
                case_id=f"{scenario_name}_step{i}",
                label=f"{scenario.label} — after step {i + 1}/{len(scenario.steps)}",
                entries=tuple(cumulative),
                dangerous=_dangerous_at_step(scenario_name, i),
                scenario=scenario_name,
                step_index=i,
            )
        )
    return cases


def static_cases() -> list[EvalCase]:
    return [
        EvalCase(
            case_id="nominal_safe",
            label="Nominal plant — sub-threshold gas, no work",
            entries=(
                _entry("sensor", {"gas_reading": 8.0, "unit": "ppm"}),
            ),
            dangerous=False,
        ),
        EvalCase(
            case_id="elevated_gas_only",
            label="Elevated gas only — single-sensor sub-critical",
            entries=(
                _entry("sensor", {"gas_reading": 25.0, "unit": "ppm"}),
            ),
            dangerous=False,
        ),
        EvalCase(
            case_id="critical_gas_only",
            label="Critical gas alone — both baselines should alarm",
            entries=(
                _entry("sensor", {"gas_reading": 55.0, "unit": "ppm"}),
            ),
            dangerous=True,
        ),
        EvalCase(
            case_id="vsp_pattern_subcritical",
            label="VSP pattern — compound block while gas still sub-critical",
            entries=(
                _entry("sensor", {"gas_reading": 25.0, "unit": "ppm"}),
                _entry(
                    "permit",
                    {"permit_id": "p-vsp", "status": "active", "work_type": "hot_work"},
                ),
                _entry(
                    "worker_location",
                    {"worker_id": "w-1", "zone": "hazardous"},
                ),
            ),
            dangerous=True,
        ),
        EvalCase(
            case_id="permit_conflict_only",
            label="Permit conflict only — elevated, not compound-block",
            entries=(
                _entry(
                    "permit",
                    {"permit_id": "p1", "status": "active", "work_type": "hot_work"},
                ),
                _entry(
                    "permit",
                    {"permit_id": "p2", "status": "active", "work_type": "cold_work"},
                ),
            ),
            dangerous=False,
        ),
    ]


def build_dataset() -> list[EvalCase]:
    cases: list[EvalCase] = []
    cases.extend(static_cases())
    for name in ("vsp_coke_oven", "compound_risk", "gas_leak", "permit_conflict"):
        cases.extend(scenario_timeline_cases(name))
    return cases


def hero_checkpoint() -> EvalCase:
    """The one-story moment: compound blocks, single-sensor still silent."""
    for case in build_dataset():
        if case.case_id == "vsp_coke_oven_step2":
            return case
    raise LookupError("vsp_coke_oven_step2 not found in dataset")
