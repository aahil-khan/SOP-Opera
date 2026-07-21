"""
Guards against the eval harness measuring itself.

The original harness labeled cases with `_dangerous_at_step()`, whose docstring
read "When compound fusion should reach blocking before single-sensor critical."
Ground truth was defined as whatever the detector did, so the compound engine
scored a 0% false-negative rate by construction.

These tests make that regression loud rather than silent.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

import app.eval.hazard_ground_truth as gt
from app.eval.dataset import build_dataset
from app.eval.detectors import compound_alarm, single_sensor_alarm

FORBIDDEN_MODULES = ("app.risk", "app.risk.policy")
FORBIDDEN_NAMES = ("evaluate_rules", "classify", "compound_alarm", "_fuse_risk")


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    mods: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            mods.add(node.module)
    return mods


def test_ground_truth_does_not_import_the_risk_policy():
    """Labels must not be derived from the thing being measured."""
    mods = _imported_modules(Path(inspect.getfile(gt)))
    for forbidden in FORBIDDEN_MODULES:
        assert not any(
            m == forbidden or m.startswith(forbidden + ".") for m in mods
        ), f"hazard_ground_truth imports {forbidden} — labels would be circular"


def test_ground_truth_does_not_call_the_rule_engine():
    """Labels read raw context payloads, not our derived facts."""
    source = Path(inspect.getfile(gt)).read_text(encoding="utf-8")
    tree = ast.parse(source)
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    } | {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    leaked = called & set(FORBIDDEN_NAMES)
    assert not leaked, f"ground truth calls detector code: {leaked}"


def test_labels_and_detector_actually_disagree_somewhere():
    """
    The strongest circularity signal is perfect agreement. Our engine is
    deliberately more conservative than the statutory minimum, so some
    disagreement must exist — if it ever vanishes, the labels have probably
    collapsed back onto the detector.
    """
    cases = build_dataset()
    disagreements = [
        c for c in cases if compound_alarm(list(c.entries)) != c.dangerous
    ]
    assert disagreements, (
        "compound detector agrees with ground truth on every one of "
        f"{len(cases)} cases — check that labels are still independent"
    )


def test_dataset_is_large_enough_to_report_percentages():
    cases = build_dataset()
    positives = sum(1 for c in cases if c.dangerous)
    assert len(cases) >= 200, "too few cases to quote a confusion matrix"
    assert positives >= 50, "too few dangerous cases to quote a false-negative rate"
    assert len(cases) - positives >= 50, "too few safe cases to quote precision"


def test_every_case_carries_a_label_rationale():
    """A label a judge cannot interrogate is not evidence."""
    for case in build_dataset():
        assert case.label_rationale, f"{case.case_id} has no label rationale"
        if case.dangerous:
            assert case.label_criteria, f"{case.case_id} is dangerous but cites nothing"


def test_single_sensor_baseline_is_not_trivially_perfect():
    """Sanity: the baseline must miss things, or the dataset has no compound cases."""
    cases = build_dataset()
    missed = [
        c for c in cases if c.dangerous and not single_sensor_alarm(list(c.entries))
    ]
    assert missed, "single-sensor baseline catches everything — dataset lacks compound risk"


def test_eval_cases_use_real_spaced_timestamps():
    """
    Every entry in a case previously shared one timestamp, which pushed the OLS
    fit into its degenerate synthetic-cadence branch and made the forecast
    detector meaningless.
    """
    multi = [c for c in build_dataset() if len(c.entries) >= 3]
    assert multi
    assert any(
        len({e.valid_from for e in c.entries}) > 1 for c in multi
    ), "no multi-entry case has distinct timestamps"
