"""
The reversibility envelope — the gate deciding what may act without a human.

This module is the whole argument for W1. An emergency response system that acts
on its own is only defensible if the boundary of its autonomy is *checkable*, so
the boundary lives here as a function over declarative data rather than as a
paragraph in a slide. `may_execute_autonomously()` is the single place that
answers "is this allowed to happen by itself", and every caller goes through it.

## The four clauses

An action may execute autonomously **iff all four** hold:

1. **Reversible** — the effect can be undone by the same mechanism.
2. **Fail-safe in direction** — the action moves a device *toward* its protective
   state. Automation may only ever make the plant safer; making it less safe
   (ventilation off, a gate reopened) is never automatic and is exactly what
   revocation is for. Revocation is a human act.
3. **Bounded blast radius** — the action touches one asset or one zone, and that
   zone is inside the affected set for this incident. Plant-wide is by
   definition not bounded and never qualifies.
4. **Tier 2 or below** — Tier 3 (shutdown, depressurization, declaring an
   evacuation complete) fails this clause in code, not by convention.

A refusal is a returned value, persisted and rendered struck-through on the
response rail. The boundary is visible rather than merely absent — an absent
feature looks like one we did not build; a refused action looks like one we
decided not to automate.

## Why paging counts as reversible

A page cannot be un-sent, but the *effect* — a responder believing they are
needed — is undone by the same mechanism: a stand-down page. Revoking a paging
action dispatches one. That is how a real control room retracts a call-out, and
it is why `page_response_team` satisfies clause 1.

Nothing here touches `app.risk`, `app.context` or `app.eval`. This module is pure
and has no I/O, so the gate is unit-testable without a database.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

BlastRadius = Literal["none", "asset", "zone", "plant"]

MAX_AUTONOMOUS_TIER = 2
"""Tier 3 exists to be refused. Raising this is the one-line way to break W1."""


# --- Device protective states ------------------------------------------------

PROTECTIVE_STATE: dict[str, str] = {
    "ventilation": "on",
    "pa_zone": "announcing",
    "exclusion_signage": "lit",
    "tool_issuance_gate": "closed",
    "muster_alarm": "sounding",
    "permit_gate": "frozen",
}
"""
The state of each device kind that represents *more* protection.

Clause 2 is checked against this map: an autonomous action may only command a
device into its protective state. The inverse move always needs a human.
"""


# --- Action registry ---------------------------------------------------------


@dataclass(frozen=True)
class ActionSpec:
    """A declarative description of one thing the orchestrator can do."""

    kind: str
    tier: int
    label: str
    reversible: bool
    blast_radius: BlastRadius
    device_kind: str | None = None
    commanded_state: str | None = None
    """State the device is driven to. Must equal PROTECTIVE_STATE[device_kind]."""
    reversal: str = "restore previous state"
    """How clause 1 is satisfied — shown in the envelope explainer."""


ACTION_REGISTRY: dict[str, ActionSpec] = {
    # --- Tier 0 · preserve -------------------------------------------------
    # Writes an evidence snapshot. Touches no plant state at all, hence a
    # blast radius of "none": there is nothing physical to bound.
    "preserve_evidence": ActionSpec(
        kind="preserve_evidence",
        tier=0,
        label="Evidence snapshot preserved",
        reversible=True,
        blast_radius="none",
        reversal="snapshot is additive; discarding it changes no plant state",
    ),
    # --- Tier 1 · warn -----------------------------------------------------
    "pa_announcement": ActionSpec(
        kind="pa_announcement",
        tier=1,
        label="PA announcement",
        reversible=True,
        blast_radius="zone",
        device_kind="pa_zone",
        commanded_state="announcing",
        reversal="stand-down announcement on the same PA zone",
    ),
    "exclusion_signage": ActionSpec(
        kind="exclusion_signage",
        tier=1,
        label="Exclusion signage lit",
        reversible=True,
        blast_radius="zone",
        device_kind="exclusion_signage",
        commanded_state="lit",
        reversal="signage cleared",
    ),
    "page_response_team": ActionSpec(
        kind="page_response_team",
        tier=1,
        label="Response team paged",
        reversible=True,
        blast_radius="zone",
        reversal="stand-down page to every contact already dispatched",
    ),
    # --- Tier 2 · protect --------------------------------------------------
    "ventilation_on": ActionSpec(
        kind="ventilation_on",
        tier=2,
        label="Ventilation started",
        reversible=True,
        blast_radius="zone",
        device_kind="ventilation",
        commanded_state="on",
        reversal="ventilation returned to its prior state",
    ),
    "tool_issuance_gate_closed": ActionSpec(
        kind="tool_issuance_gate_closed",
        tier=2,
        label="Tool issuance gate closed",
        reversible=True,
        blast_radius="zone",
        device_kind="tool_issuance_gate",
        commanded_state="closed",
        reversal="gate reopened by a supervisor",
    ),
    "permit_freeze": ActionSpec(
        kind="permit_freeze",
        tier=2,
        label="Permit frozen",
        reversible=True,
        blast_radius="asset",
        device_kind="permit_gate",
        commanded_state="frozen",
        reversal="permit unfrozen; no permit state was destroyed",
    ),
    "muster_alarm": ActionSpec(
        kind="muster_alarm",
        tier=2,
        label="Muster alarm sounded",
        reversible=True,
        blast_radius="zone",
        device_kind="muster_alarm",
        commanded_state="sounding",
        reversal="alarm silenced and stand-down announced",
    ),
    # --- Tier 3 · never automatic -----------------------------------------
    # Registered precisely so they can be refused and shown. Each is
    # irreversible, plant-wide, or both — and all are tier 3, so clause 4
    # refuses them even if someone later marks one reversible.
    "unit_shutdown": ActionSpec(
        kind="unit_shutdown",
        tier=3,
        label="Unit shutdown",
        reversible=False,
        blast_radius="plant",
        reversal="restart is a multi-hour procedure, not an undo",
    ),
    "depressurize": ActionSpec(
        kind="depressurize",
        tier=3,
        label="Depressurization",
        reversible=False,
        blast_radius="plant",
        reversal="none — venting cannot be reversed",
    ),
    "evacuation_complete": ActionSpec(
        kind="evacuation_complete",
        tier=3,
        label="Declare evacuation complete",
        reversible=False,
        blast_radius="plant",
        reversal="none — a false all-clear sends people back in",
    ),
}


TIER_LABELS: dict[int, str] = {
    0: "Preserve",
    1: "Warn",
    2: "Protect",
    3: "Never automatic",
}


def actions_for_tier(tier: int) -> list[ActionSpec]:
    """Registry entries at one tier, in declaration order."""
    return [spec for spec in ACTION_REGISTRY.values() if spec.tier == tier]


# --- The gate ----------------------------------------------------------------


@dataclass(frozen=True)
class Verdict:
    """Result of the gate. `allowed` is the only thing a caller may act on."""

    allowed: bool
    clauses: dict[str, bool]
    """Every clause and whether it passed — rendered by the envelope explainer."""
    reason: str
    """Empty when allowed; the first failing clause stated plainly otherwise."""

    @property
    def refused(self) -> bool:
        return not self.allowed


def may_execute_autonomously(
    spec: ActionSpec,
    *,
    device_zone: str | None,
    affected_zones: frozenset[str] | set[str],
) -> Verdict:
    """
    Decide whether `spec` may execute without a human.

    `device_zone` is the zone of the device this action would drive (None for
    actions with no device, such as paging or evidence preservation).
    `affected_zones` is the incident's blast-radius set — the review's asset zone
    plus its spatial neighbours.

    Evaluates all four clauses (rather than short-circuiting) so the explainer
    can show which ones held for an action that was refused on one.
    """
    reversible = spec.reversible

    # Clause 2 — an autonomous action may only move a device toward protection.
    # Actions with no device (paging, evidence) cannot move anything unsafely,
    # so they satisfy this trivially.
    if spec.device_kind is None:
        fail_safe_direction = True
    else:
        protective = PROTECTIVE_STATE.get(spec.device_kind)
        fail_safe_direction = (
            protective is not None and spec.commanded_state == protective
        )

    # Clause 3 — one asset or one zone, and that zone inside the affected set.
    # "plant" is never bounded; "none" touches nothing physical.
    if spec.blast_radius == "none":
        bounded = True
    elif spec.blast_radius == "plant":
        bounded = False
    elif device_zone is None:
        # Zone-scoped but device-less (paging): bounded as long as the incident
        # has an affected zone to scope it to.
        bounded = bool(affected_zones)
    else:
        bounded = device_zone in affected_zones

    within_tier = spec.tier <= MAX_AUTONOMOUS_TIER

    # Tier is checked first because it is the categorical clause: "Tier 3 is
    # never automatic" is the statement we want reported for a shutdown, even
    # though such an action also fails reversibility and boundedness. The dict
    # is ordered, and the loop below reports the first failure.
    clauses = {
        "tier_permits_automation": within_tier,
        "reversible": reversible,
        "fail_safe_direction": fail_safe_direction,
        "bounded_blast_radius": bounded,
    }

    reasons = {
        "reversible": f"{spec.label} cannot be undone by the same mechanism.",
        "fail_safe_direction": (
            f"{spec.label} would move the device away from its protective state; "
            "automation may only make the plant safer."
        ),
        "bounded_blast_radius": (
            f"{spec.label} is not bounded to the affected area "
            f"(radius={spec.blast_radius}, device zone={device_zone!r})."
        ),
        "tier_permits_automation": (
            f"{spec.label} is Tier {spec.tier} — never executed automatically. "
            "A human must initiate it."
        ),
    }

    for name, passed in clauses.items():
        if not passed:
            return Verdict(allowed=False, clauses=clauses, reason=reasons[name])

    return Verdict(allowed=True, clauses=clauses, reason="")


def envelope_payload(spec: ActionSpec, verdict: Verdict) -> dict:
    """The JSONB blob stored on the action row and shown in the report."""
    return {
        "tier": spec.tier,
        "reversible": spec.reversible,
        "blast_radius": spec.blast_radius,
        "commanded_state": spec.commanded_state,
        "reversal": spec.reversal,
        "clauses": verdict.clauses,
        "allowed": verdict.allowed,
        "refusal_reason": verdict.reason or None,
    }
