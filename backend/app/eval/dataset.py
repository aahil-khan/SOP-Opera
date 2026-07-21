"""
Labeled evaluation snapshots — parameter sweep + scenario timeline replay.

Every case is labeled by `hazard_ground_truth.label()`, which reads raw context
payloads against statutory stop-work criteria. Nothing in this module decides
whether a case is dangerous by asking our own detector — see the module docstring
in `hazard_ground_truth.py` for why that matters.

Timestamps are **physical process time**, not simulator playback pacing. Sensor
samples are spaced minutes apart so that the OLS trend forecast operates on a
real time axis; previously every entry in a case shared one timestamp, which sent
`_ols_fit` into its degenerate synthetic-cadence branch and made the forecast
row meaningless.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from app.context.derived_facts import ContextEntryView
from app.eval.hazard_ground_truth import GroundTruth, label
from app.simulator.dsl import ScenarioStep, load_scenario

EVAL_ASSET = UUID("11111111-1111-1111-1111-111111111111")
NOW = datetime(2026, 1, 15, 8, 0, tzinfo=timezone.utc)

SWEEP_SAMPLE_INTERVAL_MINUTES = 5.0
"""Spacing between synthetic sensor samples in a swept case."""


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    label: str
    entries: tuple[ContextEntryView, ...]
    dangerous: bool
    """Ground truth: a statutory stop-work provision applies."""
    ground_truth: GroundTruth | None = None
    scenario: str | None = None
    step_index: int | None = None
    minutes_from_start: float | None = None
    """Physical process time of this snapshot, for lead-time measurement."""

    @property
    def label_rationale(self) -> str:
        return self.ground_truth.rationale if self.ground_truth else ""

    @property
    def label_criteria(self) -> tuple[str, ...]:
        return self.ground_truth.criteria if self.ground_truth else ()


def _entry(
    category: str,
    payload: dict,
    *,
    asset_id: UUID = EVAL_ASSET,
    at_minutes: float = 0.0,
    valid_hours: float = 4.0,
) -> ContextEntryView:
    """A context entry stamped at a physical offset (minutes) from NOW."""
    ts = NOW + timedelta(minutes=at_minutes)
    return ContextEntryView(
        id=uuid4(),
        asset_id=asset_id,
        category=category,
        payload=payload,
        provider="eval",
        valid_from=ts,
        valid_until=ts + timedelta(hours=valid_hours),
        confidence=1.0,
    )


def _make_case(
    case_id: str,
    label_text: str,
    entries: list[ContextEntryView],
    **kwargs,
) -> EvalCase:
    gt = label(entries)
    return EvalCase(
        case_id=case_id,
        label=label_text,
        entries=tuple(entries),
        dangerous=gt.dangerous,
        ground_truth=gt,
        **kwargs,
    )


# --- Scenario timeline replay ----------------------------------------------


def _step_offset_minutes(step: ScenarioStep, index: int) -> float:
    """
    Physical time of a scenario step.

    `t_offset_minutes` is process time; `delay_seconds` is how fast the demo
    replays. They are deliberately different numbers — a gas excursion that
    develops over half an hour is shown in half a minute.
    """
    if step.t_offset_minutes is not None:
        return float(step.t_offset_minutes)
    # No physical timeline declared — fall back to one sample per minute so the
    # trend fit still has a real, monotonic axis.
    return float(index)


def scenario_timeline_cases(scenario_name: str) -> list[EvalCase]:
    scenario = load_scenario(scenario_name)
    cumulative: list[ContextEntryView] = []
    cases: list[EvalCase] = []
    for i, step in enumerate(scenario.steps):
        at = _step_offset_minutes(step, i)
        cumulative.append(
            _entry(
                step.category,
                dict(step.payload),
                at_minutes=at,
                valid_hours=step.valid_for_hours,
            )
        )
        cases.append(
            _make_case(
                f"{scenario_name}_step{i}",
                f"{scenario.label} — after step {i + 1}/{len(scenario.steps)}",
                list(cumulative),
                scenario=scenario_name,
                step_index=i,
                minutes_from_start=at,
            )
        )
    return cases


# --- Parameter sweep --------------------------------------------------------

# One representative per band, with the boundary value itself used for the
# critical band rather than a value comfortably above it. Sampling exactly on a
# threshold is deliberate. An
# off-by-one between the rule engine and the statutory criteria (`>` vs `>=`) is
# invisible unless the sweep samples the boundary, and one was hiding here: gas
# at exactly the action level with personnel present was a silent false negative.
GAS_LEVELS: tuple[tuple[str, float], ...] = (
    ("clean", 8.0),
    ("low", 15.0),
    ("action-exact", 20.0),
    ("elevated", 25.0),
    ("high", 42.0),
    ("critical-exact", 50.0),
)
TRAJECTORIES: tuple[str, ...] = ("flat", "rising")
TEMP_LEVELS: tuple[tuple[str, float], ...] = (
    ("normal", 60.0),
    ("elevated-exact", 80.0),
    ("elevated", 90.0),
    ("critical-exact", 120.0),
)

# Mutually exclusive permit configurations: (name, [(permit_id, work_type)], isolated_ids)
# Keeping these exclusive rather than as independent flags keeps the grid balanced —
# only one config in six is a SIMOPS violation.
WORK_CONFIGS: tuple[tuple[str, tuple[tuple[str, str], ...], frozenset[str]], ...] = (
    ("no_permit", (), frozenset()),
    ("coldwork", (("cw", "cold_work"),), frozenset()),
    ("hotwork_isolated", (("hw", "hot_work"),), frozenset({"hw"})),
    ("hotwork_unisolated", (("hw", "hot_work"),), frozenset()),
    ("confined_isolated", (("cs", "confined_space"),), frozenset({"cs"})),
    ("hotwork_and_confined", (("hw", "hot_work"), ("cs", "confined_space")), frozenset({"hw", "cs"})),
)


def _gas_series(final: float, trajectory: str) -> list[float]:
    """Three samples ending at `final`, five minutes apart."""
    if trajectory == "rising":
        start = round(final * 0.45, 1)
        mid = round((start + final) / 2, 1)
        return [start, mid, final]
    return [final, final, final]


def sweep_cases() -> list[EvalCase]:
    """
    A grid over the variables that decide whether work is safe: atmosphere level
    and trajectory, permit/isolation state, concurrent confined-space entry,
    personnel presence, and process temperature.

    This exists because 17 hand-written cases cannot support a confusion matrix.
    """
    cases: list[EvalCase] = []
    permit_at = -SWEEP_SAMPLE_INTERVAL_MINUTES
    for gas_name, gas in GAS_LEVELS:
        for traj in TRAJECTORIES:
            for work_name, permits, isolated in WORK_CONFIGS:
                for worker in (False, True):
                    for temp_name, temp in TEMP_LEVELS:
                        entries: list[ContextEntryView] = []

                        series = _gas_series(gas, traj)
                        n = len(series)
                        for idx, value in enumerate(series):
                            entries.append(
                                _entry(
                                    "sensor",
                                    {"gas_reading": value, "unit": "ppm"},
                                    at_minutes=-SWEEP_SAMPLE_INTERVAL_MINUTES
                                    * (n - 1 - idx),
                                )
                            )
                        entries.append(
                            _entry(
                                "sensor",
                                {"temp_reading": temp, "unit": "C"},
                                at_minutes=0.0,
                            )
                        )

                        for permit_id, work_type in permits:
                            entries.append(
                                _entry(
                                    "permit",
                                    {
                                        "permit_id": permit_id,
                                        "status": "active",
                                        "work_type": work_type,
                                    },
                                    at_minutes=permit_at,
                                )
                            )
                            if permit_id in isolated:
                                entries.append(
                                    _entry(
                                        "isolation_status",
                                        {
                                            "permit_id": permit_id,
                                            "isolation_confirmed": True,
                                        },
                                        at_minutes=permit_at,
                                    )
                                )
                        if worker:
                            entries.append(
                                _entry(
                                    "worker_location",
                                    {"worker_id": "w-sweep", "zone": "hazardous"},
                                    at_minutes=0.0,
                                )
                            )

                        cid = (
                            f"sweep_gas-{gas_name}_{traj}_{work_name}"
                            f"_w-{int(worker)}_temp-{temp_name}"
                        )
                        desc = (
                            f"gas {gas_name} ({traj}), {work_name.replace('_', ' ')}, "
                            f"{'worker in zone, ' if worker else ''}temp {temp_name}"
                        )
                        cases.append(_make_case(cid, desc, entries))
    return cases


# --- Named cases kept for narrative continuity ------------------------------


def static_cases() -> list[EvalCase]:
    """Hand-written cases that carry the story; labeled the same way as the sweep."""
    return [
        _make_case(
            "nominal_safe",
            "Nominal plant — sub-threshold gas, no work",
            [_entry("sensor", {"gas_reading": 8.0, "unit": "ppm"})],
        ),
        _make_case(
            "elevated_gas_only",
            "Elevated gas only — no work, no personnel",
            [_entry("sensor", {"gas_reading": 25.0, "unit": "ppm"})],
        ),
        _make_case(
            "critical_gas_only",
            "Critical gas alone — both baselines should alarm",
            [_entry("sensor", {"gas_reading": 55.0, "unit": "ppm"})],
        ),
        _make_case(
            "vsp_pattern_subcritical",
            "VSP pattern — compound block while gas still sub-critical",
            [
                _entry("sensor", {"gas_reading": 25.0, "unit": "ppm"}),
                _entry(
                    "permit",
                    {"permit_id": "p-vsp", "status": "active", "work_type": "hot_work"},
                ),
                _entry("worker_location", {"worker_id": "w-1", "zone": "hazardous"}),
            ],
        ),
        _make_case(
            "permit_conflict_only",
            "Two compatible permits, clean atmosphere",
            [
                _entry(
                    "permit",
                    {"permit_id": "p1", "status": "active", "work_type": "hot_work"},
                ),
                _entry(
                    "permit",
                    {"permit_id": "p2", "status": "active", "work_type": "cold_work"},
                ),
            ],
        ),
    ]


SCENARIOS: tuple[str, ...] = (
    "vsp_coke_oven",
    "compound_risk",
    "gas_leak",
    "permit_conflict",
)


def build_dataset() -> list[EvalCase]:
    cases: list[EvalCase] = []
    cases.extend(static_cases())
    for name in SCENARIOS:
        cases.extend(scenario_timeline_cases(name))
    cases.extend(sweep_cases())
    return cases


def hero_checkpoint() -> EvalCase:
    """The one-story moment: compound blocks, single-sensor still silent."""
    for case in build_dataset():
        if case.case_id == "vsp_coke_oven_step2":
            return case
    raise LookupError("vsp_coke_oven_step2 not found in dataset")
