"""
Pattern discovery over closed operating history (W13).

## What this is for

The rule engine is deliberately memoryless and per-asset: `derived_facts.py`
rules see one `ContextEntryView` and never "what happened last week" or "what the
asset next door is doing", and `risk/policy.py` turns one event's facts into one
verdict. That purity is load-bearing for the eval harness — and it means there is
a whole class of pattern the rule set *structurally cannot state*.

This module looks for exactly that class, and nothing else. Three families, each
defined by the axis it spans:

* `recurrence`  — across events on one asset
* `asset_pair`  — across two assets
* `shift_band`  — across time of day

A fourth family, `within_event`, mines plain fact co-occurrence inside a single
event. That one *is* expressible as a rule, and is mined anyway so the reported
set is complete rather than filtered to flatter: every row it produces is checked
against `classify()` and marked as already covered.

## Why the first three cannot be circular

`classify()` is a deterministic function of one event's fact set. Mining fact
combinations against verdicts therefore recovers that function and nothing more —
lift is maximal, coverage is always "yes", and the exercise proves only that the
rules are the rules. The three cross-axis families escape that because no
function of a single event can express them, so any structure found is a property
of the plant rather than an echo of the policy.

## Guarding against noise

There are far more candidate asset pairs than fact types, so a plain
support-and-ratio bar would let chance findings through on the widest family.
Every candidate must therefore also hold in **both halves of the corpus**
independently (`stable_keys`). It is a cheap guard and it survives being
explained in one sentence, which the alternatives — corrected p-values, FDR —
do not.

Nothing here reads the database. Callers hand it events; `eval/` follows the same
split for the same reason.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from math import sqrt
from statistics import NormalDist
from typing import Callable, Iterable, Literal, Sequence

Family = Literal["recurrence", "asset_pair", "shift_band", "within_event"]

NON_NOMINAL = ("elevated", "blocking")

# --- Thresholds -------------------------------------------------------------
# Stated in the product, not just here: a statistic without its bar is a claim
# the reader cannot check.

MIN_SUPPORT = 8
"""Occurrences of the antecedent before a candidate may be proposed at all."""

MIN_RATIO = 1.3
"""How much more often the consequent must follow, versus its base rate."""

SHIFT_HOURS = 8
"""Plant shifts. Matched to the corpus, which runs 06:00 / 14:00 / 22:00."""


@dataclass(frozen=True)
class Event:
    """One closed review, as the miner sees it."""

    review_id: str
    asset_id: str
    asset_name: str
    at: datetime
    facts: tuple[str, ...]
    verdict: str

    @property
    def non_nominal(self) -> bool:
        return self.verdict in NON_NOMINAL


@dataclass(frozen=True)
class Candidate:
    """A proposed pattern, with everything needed to judge it."""

    key: str
    """Stable identity, so a ratification survives a re-run."""

    family: Family
    claim: str
    """The finding in plain words. This is the headline a supervisor reads."""

    hits: int
    trials: int
    base_rate: float
    ratio: float
    """How much more often than the base rate. 'lift', said in English."""

    why_no_rule: str
    """Concretely why no rule could state this. Empty when one already does."""

    covered_by: str | None = None
    """Policy clause already covering it, for `within_event` candidates."""

    review_ids: tuple[str, ...] = field(default=())
    """Supporting closures, so the claim can be opened and checked."""

    chance_p: float = 1.0
    """Probability of seeing at least this many hits if nothing were going on."""

    tests: int = 1
    """How many candidates this family compared, for the multiple-testing bar."""

    @property
    def rate(self) -> float:
        return self.hits / self.trials if self.trials else 0.0


ALPHA = 0.001
"""
Family-wise error rate, after correcting for how many patterns were compared.

Deliberately stricter than the usual 0.01. A false positive here is not a wrong
number in a report — it is a confident, plainly-worded claim about plant safety
on a screen a supervisor is meant to act on. Missing a real pattern costs far
less than inventing one.
"""


def chance_probability(hits: int, trials: int, base: float) -> float:
    """
    How likely is at least this many hits if the base rate were the whole story?

    Normal approximation with a continuity correction. Exact binomial tails
    overflow well before the corpus sizes here, and at these trial counts the
    approximation is indistinguishable.
    """
    if trials <= 0 or not 0 < base < 1:
        return 1.0
    mu = trials * base
    sd = sqrt(trials * base * (1 - base))
    if sd <= 0:
        return 0.0 if hits > mu else 1.0
    z = (hits - 0.5 - mu) / sd
    return 1.0 - NormalDist().cdf(z)


def survives_multiple_testing(cand: "Candidate") -> bool:
    """
    Bonferroni over the number of patterns the family compared.

    This is the guard that stops the widest family manufacturing findings. Eight
    assets are 56 ordered pairs, and at a plain ratio bar a one-in-six fluke on
    any of them clears it — which is how a miner ends up confidently presenting
    noise. Said in one sentence: a pattern is only reported if seeing it that
    often by chance is rarer than one in (100 x the number of patterns checked).
    """
    return cand.chance_p * max(cand.tests, 1) < ALPHA


def smoothed(hits: int, trials: int) -> float:
    """
    Base rate with one notional occurrence added either way.

    Without it a control group that happens to contain zero occurrences makes
    the ratio a division by zero, and the most perfectly persistent pattern in
    the corpus is silently dropped. Additive smoothing is also the honest
    reading: never having seen a thing is not the same as it being impossible.
    """
    return (hits + 1) / (trials + 2)


def _ratio(rate: float, base: float) -> float:
    if base <= 0:
        return 0.0
    return rate / base


def _passes(hits: int, trials: int, base: float) -> bool:
    if trials < MIN_SUPPORT or base <= 0:
        return False
    return _ratio(hits / trials, base) >= MIN_RATIO


def _by_asset(events: Sequence[Event]) -> dict[str, list[Event]]:
    out: dict[str, list[Event]] = defaultdict(list)
    for e in sorted(events, key=lambda x: x.at):
        out[e.asset_id].append(e)
    return out


def stable_keys(
    events: Sequence[Event],
    refit: Callable[[Sequence[Event]], list["Candidate"]],
) -> set[str]:
    """
    Keys this family finds independently in BOTH halves of the corpus.

    The guard against mining noise out of the widest families: a pattern that
    only appears when both halves are pooled is a pattern that did not happen
    twice.

    Returns the whole surviving set rather than answering per candidate, because
    per-candidate was quadratic — it re-mined the entire family twice for every
    candidate the family produced. On 835 events the asset-pair family alone
    yields ~100 candidates over 702 ordered pairs, so the endpoint spent minutes
    recomputing the same two halves two hundred times.
    """
    ordered = sorted(events, key=lambda e: e.at)
    mid = len(ordered) // 2
    if mid < MIN_SUPPORT:
        return set()
    halves = (ordered[:mid], ordered[mid:])
    per_half = [
        {c.key for c in refit(half) if survives_multiple_testing(c)}
        for half in halves
    ]
    return per_half[0] & per_half[1]


# --- Family 1 · across events on one asset ----------------------------------


def mine_recurrence(events: Sequence[Event]) -> list[Candidate]:
    """
    Does a condition come back at the asset's *next* inspection?

    Deliberately "next event on this asset" rather than a wall-clock window:
    assets are inspected on a round, so a fixed 24h window would mostly compare
    an asset against a day it was never looked at.
    """
    per_asset = _by_asset(events)
    pairs: list[tuple[Event, Event]] = []
    for seq in per_asset.values():
        pairs.extend(zip(seq, seq[1:]))
    if not pairs:
        return []

    fact_types = {f for e in events for f in e.facts}
    out: list[Candidate] = []
    for fact in sorted(fact_types):
        after = [(p, n) for p, n in pairs if fact in p.facts]
        without = [(p, n) for p, n in pairs if fact not in p.facts]
        if not after or not without:
            continue
        hits = sum(1 for _, n in after if fact in n.facts)
        base_hits = sum(1 for _, n in without if fact in n.facts)
        base = smoothed(base_hits, len(without))
        if not _passes(hits, len(after), base):
            continue
        label = _humanise(fact)
        out.append(
            Candidate(
                key=f"recurrence:{fact}",
                family="recurrence",
                claim=(
                    f"Once an asset reports {label.lower()}, the same condition "
                    f"is back at its next inspection."
                ),
                hits=hits,
                trials=len(after),
                base_rate=base,
                ratio=_ratio(hits / len(after), base),
                why_no_rule=(
                    "A rule is given one event's context and no history, so it "
                    "cannot refer to the asset's previous inspection."
                ),
                review_ids=tuple(n.review_id for _, n in after if fact in n.facts),
                chance_p=chance_probability(hits, len(after), base),
                tests=len(fact_types),
            )
        )
    return out


# --- Family 2 · across two assets -------------------------------------------


def mine_asset_pairs(
    events: Sequence[Event], window_hours: int = SHIFT_HOURS
) -> list[Candidate]:
    """
    When one asset raises a review, does another follow within the window?

    Ordered pairs: A leading B is a different operational claim from B leading A,
    and a plant's process flow has a direction.
    """
    ordered = sorted(events, key=lambda e: e.at)
    if len(ordered) < 2:
        return []

    by_asset = _by_asset(ordered)
    names = {e.asset_id: e.asset_name for e in ordered}
    out: list[Candidate] = []

    def follows(anchor_at: datetime, b_events: list[Event]) -> Event | None:
        """First B strictly after the anchor and inside the window.

        Strictly after matters more than it looks. An inclusive `>= 0` also
        counts events sharing the anchor's instant, which silently widens the
        window to two slots and inflates every pair by roughly 2x — real enough
        to manufacture confident findings out of uniformly random data.
        """
        for e in b_events:
            delta = (e.at - anchor_at).total_seconds() / 3600
            if 0 < delta <= window_hours:
                return e
        return None

    for a_id, a_events in by_asset.items():
        for b_id, b_events in by_asset.items():
            if a_id == b_id:
                continue
            hits = 0
            supporting: list[str] = []
            for a in a_events:
                hit = follows(a.at, b_events)
                if hit is not None:
                    hits += 1
                    supporting.append(hit.review_id)

            # Control group, measured the same way: how often does B follow an
            # arbitrary event belonging to neither asset? Comparing against a
            # rate-per-window computed some other way is how a window definition
            # mismatch turns into a finding.
            anchors = [e for e in ordered if e.asset_id not in (a_id, b_id)]
            if len(anchors) < MIN_SUPPORT:
                continue
            base_hits = sum(1 for e in anchors if follows(e.at, b_events) is not None)
            base = smoothed(base_hits, len(anchors))

            if not _passes(hits, len(a_events), base):
                continue
            out.append(
                Candidate(
                    key=f"asset_pair:{a_id}:{b_id}",
                    family="asset_pair",
                    claim=(
                        f"When {names[a_id]} raises a review, {names[b_id]} "
                        f"raises one within {window_hours} hours."
                    ),
                    hits=hits,
                    trials=len(a_events),
                    base_rate=base,
                    ratio=_ratio(hits / len(a_events), base),
                    why_no_rule=(
                        "Derived facts are computed per asset. No rule can "
                        "reference another asset's events."
                    ),
                    review_ids=tuple(supporting),
                    chance_p=chance_probability(hits, len(a_events), base),
                    tests=max(len(by_asset) * (len(by_asset) - 1), 1),
                )
            )
    return out


# --- Family 3 · across time of day ------------------------------------------


def _band(at: datetime, start_hour: int = 6) -> int:
    return ((at.hour - start_hour) % 24) // SHIFT_HOURS


def _band_label(band: int, start_hour: int = 6) -> str:
    a = (start_hour + band * SHIFT_HOURS) % 24
    b = (a + SHIFT_HOURS) % 24
    return f"{a:02d}:00–{b:02d}:00"


def mine_shift_bands(events: Sequence[Event], start_hour: int = 6) -> list[Candidate]:
    """
    Is one shift worse than the plant's own average?

    Measured on the **blocking** rate, not on non-nominal. A review only opens
    when a rule fires, so in a corpus built from closures every event is
    non-nominal by construction — measured at 835/835 — and a non-nominal
    consequent is degenerate: every band scores 1.00x and the family can never
    report anything, whatever the plant is doing. Blocking is also the outcome
    that matters operationally.
    """
    if not events:
        return []
    buckets: dict[int, list[Event]] = defaultdict(list)
    for e in events:
        buckets[_band(e.at, start_hour)].append(e)

    out: list[Candidate] = []
    for band, in_band in sorted(buckets.items()):
        others = [e for e in events if _band(e.at, start_hour) != band]
        if not others:
            continue
        base = smoothed(sum(1 for e in others if e.verdict == "blocking"), len(others))
        hits = sum(1 for e in in_band if e.verdict == "blocking")
        if not _passes(hits, len(in_band), base):
            continue
        out.append(
            Candidate(
                key=f"shift_band:{band}",
                family="shift_band",
                claim=(
                    f"Work on the {_band_label(band, start_hour)} shift reaches "
                    f"a blocking verdict more often than on the other two."
                ),
                hits=hits,
                trials=len(in_band),
                base_rate=base,
                ratio=_ratio(hits / len(in_band), base),
                why_no_rule=(
                    "The rule set has no concept of a shift. This compares two "
                    "populations of reviews, not one event's facts."
                ),
                review_ids=tuple(
                    e.review_id for e in in_band if e.verdict == "blocking"
                ),
                chance_p=chance_probability(hits, len(in_band), base),
                tests=max(len(buckets), 1),
            )
        )
    return out


# --- Family 4 · inside one event (expressible as a rule — mined for honesty) --


def mine_within_event(events: Sequence[Event]) -> list[Candidate]:
    """
    Fact pairs co-occurring in a single event, against the blocking rate.

    Included so the reported set is complete. Every row here is checked against
    the live policy by `annotate_coverage()`, and in a healthy system they all
    come back covered — which is the honest finding, not a disappointing one.
    """
    if not events:
        return []
    base = smoothed(sum(1 for e in events if e.verdict == "blocking"), len(events))
    pairs: dict[tuple[str, str], list[Event]] = defaultdict(list)
    for e in events:
        fs = sorted(set(e.facts))
        for i, a in enumerate(fs):
            for b in fs[i + 1 :]:
                pairs[(a, b)].append(e)

    out: list[Candidate] = []
    for (a, b), evts in sorted(pairs.items()):
        hits = sum(1 for e in evts if e.verdict == "blocking")
        if not _passes(hits, len(evts), base):
            continue
        out.append(
            Candidate(
                key=f"within_event:{a}+{b}",
                family="within_event",
                claim=(
                    f"{_humanise(a)} together with {_humanise(b).lower()} "
                    f"reaches a blocking verdict."
                ),
                hits=hits,
                trials=len(evts),
                base_rate=base,
                ratio=_ratio(hits / len(evts), base),
                why_no_rule="",
                review_ids=tuple(e.review_id for e in evts if e.verdict == "blocking"),
                chance_p=chance_probability(hits, len(evts), base),
                tests=max(len(pairs), 1),
            )
        )
    return out


# --- Coverage ---------------------------------------------------------------


def annotate_coverage(candidates: Iterable[Candidate]) -> list[Candidate]:
    """
    Mark `within_event` candidates the live policy already blocks.

    Delegates to `risk.policy.classify` rather than reimplementing the gate —
    the same discipline the orchestrator and the eval harness follow, so the
    coverage we report and the verdict we ship cannot drift apart.
    """
    from app.risk.policy import classify

    out: list[Candidate] = []
    for c in candidates:
        if c.family != "within_event":
            out.append(c)
            continue
        _, _, pair = c.key.partition(":")
        a, _, b = pair.partition("+")
        verdict = classify([a, b])
        covered = verdict.level == "blocking"
        out.append(
            Candidate(
                key=c.key,
                family=c.family,
                claim=c.claim,
                hits=c.hits,
                trials=c.trials,
                base_rate=c.base_rate,
                ratio=c.ratio,
                why_no_rule=(
                    ""
                    if covered
                    else "Expressible as a rule, but no clause currently states it."
                ),
                covered_by=verdict.triggered_rule if covered else None,
                review_ids=c.review_ids,
                chance_p=c.chance_p,
                tests=c.tests,
            )
        )
    return out


# --- Entry point ------------------------------------------------------------


def mine(events: Sequence[Event], start_hour: int = 6) -> list[Candidate]:
    """
    All four families, noise-guarded, ranked most-surprising first.

    Ranked by ratio rather than support on purpose: a pattern that happened
    2,000 times at the base rate is the plant working normally.
    """
    # One callable per family, used both to mine and to re-fit on each half.
    families = [
        mine_recurrence,
        mine_asset_pairs,
        lambda evs: mine_shift_bands(evs, start_hour),
        mine_within_event,
    ]

    found: list[Candidate] = []
    for run in families:
        candidates = [c for c in run(events) if survives_multiple_testing(c)]
        if not candidates:
            continue
        # Two independent guards, and both are needed. Significance stops a
        # fluke on any one of many comparisons; split-half stops a pattern that
        # is real in one stretch of the year and absent in the other. Computed
        # once per family, not once per candidate.
        stable = stable_keys(events, run)
        found.extend(c for c in candidates if c.key in stable)

    found = annotate_coverage(found)
    return sorted(found, key=lambda c: (-c.ratio, -c.trials, c.key))


_LABELS = {
    "elevated_gas": "Elevated gas",
    "critical_gas": "Critical gas",
    "permit_conflict": "A permit conflict",
    "zone_occupied": "Personnel in a hazardous zone",
    "incomplete_isolation": "Unverified isolation",
    "simultaneous_ops": "Incompatible simultaneous operations",
    "certification_expiring": "An expiring certification",
    "over_temperature": "Over temperature",
    "critical_temperature": "Critical temperature",
    "equipment_vibration_anomaly": "A vibration anomaly",
    "effluent_quality_breach": "An effluent quality breach",
    "tank_level_critical": "A critical tank level",
    "ppe_noncompliance": "A PPE gap",
    "lifting_operation_conflict": "A lifting operation conflict",
    "weather_hold": "A weather hold",
}


def _humanise(fact_type: str) -> str:
    return _LABELS.get(fact_type, fact_type.replace("_", " ").capitalize())
