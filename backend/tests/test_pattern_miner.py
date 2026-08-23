"""
Pure-logic tests for the W13 miner. No database, no pipeline.

The important ones are the negatives: a miner that reports patterns from random
data is worse than no miner, because it is confidently wrong on stage.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from app.patterns.miner import (
    MIN_RATIO,
    Event,
    mine,
    mine_asset_pairs,
    mine_recurrence,
    mine_shift_bands,
    mine_within_event,
)

T0 = datetime(2026, 1, 1, 6, 0, tzinfo=timezone.utc)


def ev(i: int, asset: str, facts: tuple[str, ...], verdict: str = "elevated", hours: int = 0) -> Event:
    return Event(
        review_id=f"r{i}",
        asset_id=asset,
        asset_name=asset.title(),
        at=T0 + timedelta(hours=hours or i * 8),
        facts=facts,
        verdict=verdict,
    )


# --- Negatives: random data must produce nothing -----------------------------


def random_corpus(seed: int, n: int = 600) -> list[Event]:
    """i.i.d. events — no cross-event, cross-asset or cross-shift structure."""
    rng = random.Random(seed)
    facts = ["elevated_gas", "over_temperature", "permit_conflict", "zone_occupied"]
    assets = [f"a{i}" for i in range(8)]
    out = []
    for i in range(n):
        f = tuple(rng.sample(facts, k=rng.choice([0, 1, 1, 2])))
        out.append(
            Event(
                review_id=f"r{i}",
                asset_id=rng.choice(assets),
                asset_name="Asset",
                at=T0 + timedelta(hours=i * 8),
                facts=f,
                verdict=rng.choice(["nominal", "nominal", "nominal", "elevated"]),
            )
        )
    return out


def test_random_corpora_yield_essentially_no_patterns():
    """
    The guard that matters most: random data must not produce claims.

    Asserted as a rate across several corpora rather than as "exactly zero on
    one seed", because that is what the method actually promises. A significance
    bar admits false positives at its alpha by construction; demanding zero from
    a single draw would be testing luck, and would pass or fail on the seed
    rather than on the miner. What we require is that the observed rate stays at
    or below the bar we advertise.
    """
    spurious = 0
    for seed in range(8):
        found = mine(random_corpus(seed))
        spurious += len(
            [c for c in found if c.family in ("recurrence", "asset_pair", "shift_band")]
        )
    assert spurious == 0, f"mined {spurious} patterns from 8 random corpora"


def test_empty_corpus_is_not_an_error():
    assert mine([]) == []


# --- Family 1: recurrence ----------------------------------------------------


def test_recurrence_found_when_a_condition_persists():
    # Interleaved across the whole window on purpose: grouping the persistent
    # asset into one end would put it entirely in one half of the corpus, and
    # the split-half guard would reject it for the wrong reason.
    events = []
    for i in range(60):
        if i % 3 == 0:
            events.append(ev(i, "pump", ("equipment_vibration_anomaly",)))
        else:
            events.append(ev(i, f"other{i % 6}", ()))
    found = mine_recurrence(events)
    keys = [c.key for c in found]
    assert "recurrence:equipment_vibration_anomaly" in keys
    hit = next(c for c in found if c.key.endswith("equipment_vibration_anomaly"))
    assert hit.ratio >= MIN_RATIO
    assert "next inspection" in hit.claim
    # The whole argument for the feature lives on this field.
    assert "no history" in hit.why_no_rule


def test_recurrence_ignores_a_fact_that_never_repeats():
    events = []
    for i in range(40):
        facts = ("elevated_gas",) if i % 2 == 0 else ()
        events.append(ev(i, "vessel", facts))
    found = mine_recurrence(events)
    assert [c for c in found if "elevated_gas" in c.key] == []


# --- Family 2: asset pairs ---------------------------------------------------


def test_asset_pair_found_when_two_assets_move_together():
    events = []
    i = 0
    for shift in range(40):
        base = shift * 8
        events.append(ev(i, "battery", ("elevated_gas",), hours=base))
        i += 1
        events.append(ev(i, "cleaning", ("elevated_gas",), hours=base + 1))
        i += 1
    # A third asset, unrelated, on its own cadence.
    for shift in range(0, 40, 5):
        events.append(ev(i, "workshop", (), hours=shift * 8 + 400))
        i += 1
    found = mine_asset_pairs(events)
    keys = [c.key for c in found]
    assert "asset_pair:battery:cleaning" in keys
    hit = next(c for c in found if c.key == "asset_pair:battery:cleaning")
    assert "raises a review" in hit.claim
    assert "another asset" in hit.why_no_rule


# --- Family 3: shift bands ---------------------------------------------------


def test_shift_band_found_when_one_shift_is_worse():
    """
    Measured on the blocking rate. Non-nominal is degenerate here: a review only
    opens when a rule fires, so in a real closure corpus every event is
    non-nominal and every band would score 1.00x.
    """
    events = []
    i = 0
    for day in range(40):
        # 06:00 and 14:00 shifts settle at elevated, 22:00 shift blocks.
        events.append(ev(i, "a", ("elevated_gas",), "elevated", hours=day * 24))
        i += 1
        events.append(ev(i, "b", ("elevated_gas",), "elevated", hours=day * 24 + 8))
        i += 1
        events.append(
            ev(i, "c", ("elevated_gas", "incomplete_isolation"), "blocking",
               hours=day * 24 + 16)
        )
        i += 1
    found = mine_shift_bands(events)
    assert found, "expected the night band to stand out"
    hit = found[0]
    assert "22:00" in hit.claim
    assert "blocking verdict" in hit.claim
    assert "no concept of a shift" in hit.why_no_rule


def test_shift_band_is_not_degenerate_when_every_event_is_non_nominal():
    """
    The defect this metric was changed to fix. A corpus of closures has no
    nominal events at all — measured 835/835 on the seeded year — so a
    non-nominal consequent scores every band at 1.00x and the family can never
    say anything, whatever the plant is doing.
    """
    events = []
    for i in range(120):
        band = i % 3
        blocking = band == 2 and i % 6 == 2
        events.append(
            ev(
                i,
                f"a{i % 5}",
                ("elevated_gas",),
                "blocking" if blocking else "elevated",
                hours=(i // 3) * 24 + band * 8,
            )
        )
    assert all(e.non_nominal for e in events), "fixture must have no nominal events"
    # Nothing is asserted about what it finds — only that a degenerate
    # consequent is not what decides it.
    for c in mine_shift_bands(events):
        assert c.base_rate < 1.0, "base rate saturated; the consequent is degenerate"


# --- Family 4: within-event, and coverage ------------------------------------


def test_within_event_pair_is_marked_covered_by_the_live_policy():
    """
    elevated_gas + incomplete_isolation completes a pathway, so classify()
    already blocks it. The miner must say so rather than claim a discovery.
    """
    events = []
    for i in range(90):
        if i % 3 == 0:
            events.append(
                ev(i, "vessel", ("elevated_gas", "incomplete_isolation"), "blocking")
            )
        else:
            events.append(ev(i, f"other{i % 5}", (), "nominal"))
    found = mine(events)
    within = [c for c in found if c.family == "within_event"]
    assert within, "expected the pair to be mined"
    hit = within[0]
    assert hit.covered_by == "pathway_atmosphere_ignition_control"
    assert hit.why_no_rule == ""


def test_within_event_pair_not_covered_is_reported_as_such():
    """A pair that does not complete a pathway must not claim coverage."""
    events = []
    for i in range(90):
        if i % 3 == 0:
            events.append(
                ev(i, "vessel", ("permit_conflict", "zone_occupied"), "blocking")
            )
        else:
            events.append(ev(i, f"other{i % 5}", (), "nominal"))
    found = mine(events)
    within = [c for c in found if c.family == "within_event"]
    assert within
    assert within[0].covered_by is None
    assert "no clause currently states it" in within[0].why_no_rule


# --- Ranking and support -----------------------------------------------------


def test_thin_support_is_not_proposed():
    events = [ev(i, "vessel", ("elevated_gas",)) for i in range(4)]
    assert mine_recurrence(events) == []


def test_results_are_ranked_most_surprising_first():
    events = []
    for i in range(60):
        if i % 2 == 0:
            events.append(ev(i, "pump", ("equipment_vibration_anomaly",)))
        else:
            events.append(ev(i, f"other{i % 5}", ()))
    found = mine(events)
    ratios = [c.ratio for c in found]
    assert ratios == sorted(ratios, reverse=True)
