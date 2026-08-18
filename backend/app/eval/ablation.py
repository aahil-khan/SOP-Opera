"""
Hazard-dimension ablation — what each dimension contributes to compound recall.

For each hazard dimension we suppress every derived fact that supplies it and
re-score the compound detector on the same statutory labels. The drop in recall
is that dimension's contribution. `classify()` is treated as a black box: we
only change its *input* fact set, never its rules, and the ground-truth labels
are never touched (they come from `hazard_ground_truth.py`, which still cannot
import the policy — see tests/test_eval_independence.py).

Imports from `app.risk.policy` are fine here: the eval *detectors* already
delegate to the policy; it is only the labeling that must stay independent.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.eval.dataset import EvalCase, build_dataset
from app.eval.detectors import active_fact_types
from app.risk.policy import (
    DIMENSION_LABELS,
    FACT_DIMENSIONS,
    HAZARD_DIMENSIONS,
    classify,
)


@dataclass(frozen=True)
class AblationRow:
    dimension: str
    label: str
    facts_removed: tuple[str, ...]
    recall: float
    """Compound recall with this dimension's facts suppressed."""
    recall_drop: float
    """Full-detector recall minus ablated recall — the dimension's contribution."""
    fn: int
    tp: int


def _compound_alarm_for_facts(fact_types: set[str]) -> bool:
    grounded = sorted(fact_types - {"spatial_cooccurrence"})
    return classify(grounded, []).is_blocking


def run_ablation(cases: list[EvalCase] | None = None) -> list[AblationRow]:
    cases = cases or build_dataset()

    # Rules run once per case; each ablation pass only filters + reclassifies.
    scored: list[tuple[bool, set[str]]] = [
        (case.dangerous, active_fact_types(list(case.entries))) for case in cases
    ]

    def recall_with(removed_dimension: str | None) -> tuple[float, int, int]:
        tp = fn = 0
        for dangerous, facts in scored:
            if not dangerous:
                continue
            if removed_dimension is None:
                kept = facts
            else:
                kept = {
                    f
                    for f in facts
                    if removed_dimension not in FACT_DIMENSIONS.get(f, frozenset())
                }
            if _compound_alarm_for_facts(set(kept)):
                tp += 1
            else:
                fn += 1
        denom = tp + fn
        return (tp / denom if denom else 0.0), tp, fn

    full_recall, _, _ = recall_with(None)

    rows: list[AblationRow] = []
    for dim in HAZARD_DIMENSIONS:
        recall, tp, fn = recall_with(dim)
        rows.append(
            AblationRow(
                dimension=dim,
                label=DIMENSION_LABELS.get(dim, dim),
                facts_removed=tuple(
                    sorted(
                        f
                        for f, dims in FACT_DIMENSIONS.items()
                        if dim in dims
                    )
                ),
                recall=recall,
                recall_drop=full_recall - recall,
                fn=fn,
                tp=tp,
            )
        )
    return rows
