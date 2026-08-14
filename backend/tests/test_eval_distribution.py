"""W10c/d — lead-time distribution and hazard-dimension ablation (pure, no DB)."""

from __future__ import annotations

from app.eval.ablation import run_ablation
from app.eval.lead_time import all_scenario_lead_times, lead_time_distribution
from app.risk.policy import HAZARD_DIMENSIONS
from app.simulator.dsl import list_scenario_names


def test_lead_times_cover_every_scenario_yaml():
    leads = all_scenario_lead_times()
    assert sorted(s.scenario for s in leads) == sorted(list_scenario_names())
    assert len(leads) == 5


def test_hero_scenario_defines_the_known_lead():
    dist = lead_time_distribution()
    by_name = {s.scenario: s for s in dist.scenarios}
    hero = by_name["vsp_coke_oven"]
    assert hero.lead_time_minutes == 28.0
    # Every defined lead is inside the reported spread.
    assert dist.min_minutes is not None and dist.max_minutes is not None
    for s in dist.scenarios:
        if s.lead_time_minutes is not None:
            assert dist.min_minutes <= s.lead_time_minutes <= dist.max_minutes
    assert dist.defined_count >= 1


def test_ablation_rows_cover_all_dimensions_and_never_gain_recall():
    rows = run_ablation()
    assert [r.dimension for r in rows] == list(HAZARD_DIMENSIONS)
    for row in rows:
        # Removing evidence can only lose stop-work catches, never add them.
        assert row.recall_drop >= 0.0
        assert 0.0 <= row.recall <= 1.0
        assert row.facts_removed, row.dimension


def test_ablating_atmosphere_hurts_most():
    """Atmosphere carries the gas-pathway cases — the headline contribution."""
    rows = {r.dimension: r for r in run_ablation()}
    assert rows["atmosphere"].recall_drop == max(
        r.recall_drop for r in rows.values()
    )
