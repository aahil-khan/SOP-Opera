"""
Compound-risk policy — the single source of truth for how facts become a verdict.

This module is the one home for the question "is this plant state safe to work
in". Nothing here imports from `app.agents`, `app.reviews`, or `app.eval`; those
three all call *into* this module so that the verdict we ship and the verdict we
measure cannot drift apart.

## Why a hazard-pathway model rather than a fact count

The previous rule was `len(rule_facts) >= 3 -> blocking`, which treats a weather
hold, an expiring certification, and a PPE gap as equivalent to a gas release
next to unverified hot work. Counting facts measures how much we know, not how
dangerous the state is.

Instead each derived fact is mapped to the hazard *dimension* it supplies. A
harmful outcome in this plant needs a pathway — a hazardous substance, an energy
source that can initiate it, a failure of the controls meant to keep them apart,
and people in the affected space. This is the ignition-triangle reasoning a
safety engineer already uses, expressed over the facts we can actually detect.

Blocking requires either the single-sensor incident line, or a *pathway*:
co-occurrence across complementary dimensions, with human exposure or an
explicit atmosphere/ignition/control chain. Three facts from one dimension no
longer block, and three facts from unrelated dimensions no longer block unless
someone is exposed.

## Grounding

A blocking verdict must rest on at least one deterministic rule fact. Projections
and geometry are *signals*: `predicted_trend_risk` (an OLS extrapolation) and
`spatial_cooccurrence` (a proximity marker) can raise a verdict to `elevated` and
can strengthen a block that is already grounded, but neither can ground one on its
own. See NON_GROUNDING_SIGNALS.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

from app.context.derived_facts import DERIVED_FACT_RULES
from app.reviews.concerns import BLOCKING_SUPERVISOR_FACTS, SUPERVISOR_FACT_TYPES

POLICY_VERSION = "hazard-pathway-2"

RiskLevel = Literal["nominal", "elevated", "blocking"]

_LEVEL_ORDER: dict[str, int] = {"nominal": 0, "elevated": 1, "blocking": 2}


# --- Hazard dimensions ------------------------------------------------------

ATMOSPHERE = "atmosphere"
"""A hazardous substance is present or escaping containment."""

IGNITION_ENERGY = "ignition_energy"
"""An energy source capable of initiating or escalating the hazard."""

EXPOSURE = "exposure"
"""People are in, or entitled to enter, the affected space."""

CONTROL_FAILURE = "control_failure"
"""A barrier meant to keep the above apart is missing, unverified, or conflicting."""

HAZARD_DIMENSIONS: tuple[str, ...] = (
    ATMOSPHERE,
    IGNITION_ENERGY,
    EXPOSURE,
    CONTROL_FAILURE,
)

DIMENSION_LABELS: dict[str, str] = {
    ATMOSPHERE: "Hazardous atmosphere / loss of containment",
    IGNITION_ENERGY: "Ignition or energy source",
    EXPOSURE: "Personnel exposure",
    CONTROL_FAILURE: "Control / barrier failure",
}


# A fact may supply more than one dimension.
#
# `incomplete_isolation` supplies both IGNITION_ENERGY and CONTROL_FAILURE: the
# rule only fires for an active hot-work or confined-space permit whose isolation
# was never confirmed (see rule_incomplete_isolation), so it simultaneously
# evidences an energy source and the failure of the barrier around it.
FACT_DIMENSIONS: dict[str, frozenset[str]] = {
    # Hazardous substance present / containment lost
    "elevated_gas": frozenset({ATMOSPHERE}),
    "critical_gas": frozenset({ATMOSPHERE}),
    "effluent_quality_breach": frozenset({ATMOSPHERE}),
    "tank_level_critical": frozenset({ATMOSPHERE}),
    # Energy capable of initiating or escalating
    "over_temperature": frozenset({IGNITION_ENERGY}),
    "critical_temperature": frozenset({IGNITION_ENERGY}),
    "equipment_vibration_anomaly": frozenset({IGNITION_ENERGY}),
    # People in the affected space
    "zone_occupied": frozenset({EXPOSURE}),
    "ppe_noncompliance": frozenset({EXPOSURE}),
    "lifting_operation_conflict": frozenset({EXPOSURE, CONTROL_FAILURE}),
    # Barriers missing, unverified, or in conflict
    "incomplete_isolation": frozenset({IGNITION_ENERGY, CONTROL_FAILURE}),
    "permit_conflict": frozenset({CONTROL_FAILURE}),
    "simultaneous_ops": frozenset({CONTROL_FAILURE}),
    "certification_expiring": frozenset({CONTROL_FAILURE}),
    "weather_hold": frozenset({CONTROL_FAILURE}),
}

ALL_RULE_FACT_TYPES: frozenset[str] = frozenset(name for name, _ in DERIVED_FACT_RULES)

CRITICAL_SENSOR_FACTS: frozenset[str] = frozenset(
    {"critical_gas", "critical_temperature"}
)
"""The single-sensor incident line — the traditional SCADA alarm baseline."""

NON_GROUNDING_SIGNALS: frozenset[str] = frozenset(
    {"predicted_trend_risk", "spatial_cooccurrence", "unacknowledged_handover"}
)
"""
Signals that may escalate but can never ground a block on their own.

`unacknowledged_handover` means this asset carried a high-risk item across a
shift boundary that the incoming operator never acknowledged. That is a barrier
failure in the CONTROL_FAILURE sense — the barrier being the handover itself —
but it is a fact about paperwork, not about the plant. It must not manufacture a
hazard dimension, or a missed acknowledgement could complete an initiation
pathway that no sensor supports. So it escalates a nominal asset to elevated and
is reported alongside a grounded block, and does nothing else.
"""

BLOCKING_CONTROL_FACTS: frozenset[str] = frozenset({"simultaneous_ops"})
"""
Control failures severe enough to stop work on their own.

`simultaneous_ops` only fires for an incompatible pair (hot work concurrent with
confined-space entry). A permit-to-work system treats that as a stop condition
regardless of the current atmosphere, because the incompatibility *is* the
hazard — one activity defeats the controls protecting the other.
"""


def dimensions_for(fact_types: Iterable[str]) -> set[str]:
    """The hazard dimensions supplied by a set of fact types."""
    dims: set[str] = set()
    for ft in fact_types:
        dims |= FACT_DIMENSIONS.get(ft, frozenset())
    return dims


# --- Verdict ----------------------------------------------------------------


@dataclass(frozen=True)
class RiskVerdict:
    level: RiskLevel
    dimensions: tuple[str, ...]
    """Hazard dimensions evidenced by grounded rule facts."""
    grounded_facts: tuple[str, ...]
    """Deterministic rule facts backing this verdict (excludes non-grounding signals)."""
    triggered_rule: str
    """Which policy clause decided the level — for audit and for the eval report."""
    rationale: str
    policy_version: str = POLICY_VERSION
    signals: tuple[str, ...] = field(default=())
    """Non-grounding signals (trend, spatial) that contributed to escalation."""

    @property
    def is_blocking(self) -> bool:
        return self.level == "blocking"


def _max_level(a: str, b: str) -> str:
    return a if _LEVEL_ORDER[a] >= _LEVEL_ORDER[b] else b


def _spatial_hit(observations: Iterable[dict[str, Any]]) -> bool:
    return any(
        o.get("agent") == "spatial" and o.get("local_risk") in ("elevated", "blocking")
        for o in observations
    )


def _trend_hit(observations: Iterable[dict[str, Any]]) -> bool:
    return any(
        o.get("agent") == "predictive_trend"
        and o.get("local_risk") in ("elevated", "blocking")
        and "predicted_trend_risk" in (o.get("fact_types") or [])
        for o in observations
    )


def classify(
    fact_types: Iterable[str],
    observations: Iterable[dict[str, Any]] = (),
) -> RiskVerdict:
    """
    Fuse deterministic facts and agent observations into a risk verdict.

    `fact_types` are derived-fact names (plus optional non-grounding signals).
    `observations` are agent observation dicts; only `spatial` and
    `predictive_trend` influence the level, and neither can ground a block.
    """
    obs = list(observations)
    supplied = set(fact_types)

    # Grounding set: deterministic rule facts only.
    grounded = supplied - NON_GROUNDING_SIGNALS
    rule_facts = {f for f in grounded if f in ALL_RULE_FACT_TYPES}
    supervisor_facts = {f for f in grounded if f in SUPERVISOR_FACT_TYPES}

    dims = dimensions_for(rule_facts)
    spatial = _spatial_hit(obs)
    trend = _trend_hit(obs) or "predicted_trend_risk" in supplied
    handover_gap = "unacknowledged_handover" in supplied

    signals: list[str] = []
    if spatial:
        signals.append("spatial_cooccurrence")
    if trend:
        signals.append("predicted_trend_risk")
    if handover_gap:
        signals.append("unacknowledged_handover")

    level: str = "nominal"
    rule = "no_signal"
    why = "No elevated conditions detected."

    # Blocking clauses, most specific first — the first match names the verdict.
    # Ordering only decides the *reason* reported; any match blocks.
    critical = rule_facts & CRITICAL_SENSOR_FACTS
    full_chain = {ATMOSPHERE, IGNITION_ENERGY, CONTROL_FAILURE} <= dims

    blocking_clauses: list[tuple[bool, str, str]] = [
        (
            bool(critical),
            "single_sensor_critical",
            f"{_fmt(sorted(critical))} at or above the single-sensor "
            "critical/incident threshold.",
        ),
        (
            bool(supervisor_facts & BLOCKING_SUPERVISOR_FACTS),
            "supervisor_safety_hazard",
            "A supervisor reported a safety hazard directly from the floor.",
        ),
        (
            # The compound-risk claim: substance + energy + failed barrier is a
            # complete initiation pathway, whether or not anyone is present yet.
            full_chain,
            "pathway_atmosphere_ignition_control",
            "A hazardous atmosphere, an ignition/energy source, and a failed "
            "control barrier co-occur — a complete initiation pathway.",
        ),
        (
            # No ignition source is needed for an atmosphere to harm someone;
            # this is the inhalation/asphyxiation route.
            ATMOSPHERE in dims and EXPOSURE in dims,
            "pathway_atmosphere_exposure",
            "Personnel are in the affected space while the atmosphere is above "
            "its action level.",
        ),
        (
            bool(rule_facts & BLOCKING_CONTROL_FACTS),
            "incompatible_simultaneous_operations",
            "Incompatible operations are permitted concurrently on this asset; "
            "each defeats the controls protecting the other.",
        ),
        (
            EXPOSURE in dims and len(dims) >= 3,
            "pathway_multi_dimension_with_exposure",
            f"{len(dims)} complementary hazard dimensions co-occur with "
            "personnel exposed in the affected space.",
        ),
        (
            # Geometry can complete a pathway across assets, but only alongside a
            # grounded atmosphere plus exposure or control failure.
            spatial
            and ATMOSPHERE in dims
            and (EXPOSURE in dims or CONTROL_FAILURE in dims),
            "spatial_proximity_pathway",
            "A hazardous atmosphere sits within spatial proximity of work "
            "activity, with personnel or control exposure nearby.",
        ),
    ]

    for matched, clause, reason in blocking_clauses:
        if matched:
            level, rule, why = "blocking", clause, reason
            break

    # Anything else grounded, or any agent escalation, is elevated.
    if level == "nominal":
        if rule_facts or supervisor_facts:
            level, rule = "elevated", "grounded_fact_present"
            why = (
                f"{_fmt(sorted(rule_facts | supervisor_facts))} detected without a "
                "complete hazard pathway."
            )
        # Named before the generic agent escalation below, which the handover
        # agent's own observation would otherwise satisfy first and report as an
        # anonymous "an agent escalated".
        elif handover_gap:
            level, rule = "elevated", "unacknowledged_handover"
            why = (
                "A hazard on this asset was carried across a shift boundary and "
                "never acknowledged by the incoming operator."
            )
        elif any(o.get("local_risk") in ("elevated", "blocking") for o in obs):
            level, rule = "elevated", "agent_escalation"
            why = "An analysis agent escalated without a deterministic rule fact."
        elif trend:
            level, rule = "elevated", "predicted_trend"
            why = (
                "A rising trend is projected to reach the early-warning threshold "
                "within the forecast horizon."
            )

    # 8. Grounding enforcement — a block always rests on a rule fact.
    if level == "blocking" and not (rule_facts or supervisor_facts):
        level, rule = "elevated", "downgraded_ungrounded_block"
        why = (
            "Escalation rested only on projected or geometric signals with no "
            "deterministic rule fact; downgraded pending confirmation."
        )

    # A grounded verdict stands on its own facts, but the incoming operator never
    # having seen this hazard is material to whoever reads the assessment. Runs
    # last so the downgrade above cannot discard it.
    if handover_gap and rule != "unacknowledged_handover":
        why = f"{why} This hazard also crossed a shift boundary unacknowledged."

    return RiskVerdict(
        level=level,  # type: ignore[arg-type]
        dimensions=tuple(d for d in HAZARD_DIMENSIONS if d in dims),
        grounded_facts=tuple(sorted(rule_facts | supervisor_facts)),
        triggered_rule=rule,
        rationale=why,
        signals=tuple(signals),
    )


def _fmt(facts: list[str]) -> str:
    pretty = [f.replace("_", " ") for f in facts]
    if not pretty:
        return "No facts"
    if len(pretty) == 1:
        return pretty[0].capitalize()
    return (", ".join(pretty[:-1]) + f" and {pretty[-1]}").capitalize()


def is_blocking_compound(fact_types: Iterable[str]) -> bool:
    """Rule-fact-only blocking check (no agent observations available)."""
    return classify(fact_types).is_blocking
