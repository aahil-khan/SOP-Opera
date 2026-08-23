#!/usr/bin/env python3
"""
Track A — operating-history seeder (docs/track-a-tasks.md, Phase 1 spike / Phase 2 full run).

Drives reviews end-to-end — context ingest -> assessment -> decision -> close —
against a *separate* history database, going through the same service-layer
"front door" functions the HTTP API uses:

    app.context.service.ingest_context   (== POST /context)
    app.decisions.service.submit_decision (== POST /reviews/{id}/decisions)
    app.reviews.repository.transition_review, event CLOSE (== POST /reviews/{id}/close)

Never raw INSERTs — that's what keeps `audit_entries` hash-chain-valid and
`GET /audit/verify` (here: `verify_audit_chain()`) clean on the seeded DB.

Run against a database the live demo never touches (schema.sql / master data
already provisioned there — see docs/track-a-tasks.md Phase 0):

    HISTORY_DATABASE_URL=postgresql+asyncpg://sop:sop@localhost:5433/sop_opera_history \
    .venv/Scripts/python.exe scripts/seed_history.py --days 14 --seed 42

DISTRIBUTION NOTE — read before changing the ranges below.
The whole point of this generator is to feed plausible plant numbers in and
observe what mix of nominal/elevated/blocking the REAL rule engine + classify()
derive, not to target a known threshold (see docs/sop-opera-finals-workplan.md
W11a's constraint, and W13's circularity concern). The ranges below were picked
without reading backend/app/context/derived_facts.py or backend/app/risk/policy.py.

CAVEAT, disclosed rather than hidden: earlier in this session, unrelated
provider-troubleshooting work (checking .env for AI_PROVIDER/EMBEDDING_PROVIDER)
incidentally surfaced the numeric threshold *constants* in .env
(GAS_ELEVATED_THRESHOLD, GAS_CRITICAL_THRESHOLD, TEMP_ELEVATED_THRESHOLD, etc.)
— not the rule *logic* or the fact-dimension mapping in derived_facts.py/
risk/policy.py, which were never opened. To stay honest about that partial
exposure, ranges below are intentionally wide/log-spread rather than tightly
banded around any specific number, and this file's docstring says so plainly.
Before the real W11a full-scale run, it's worth having someone who hasn't seen
those constants sanity-check (or regenerate) these distributions.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--days", type=int, default=14, help="Number of simulated days to seed (default 14, the spike size)")
    p.add_argument("--shifts-per-day", type=int, default=3, help="Shifts per simulated day (default 3)")
    p.add_argument("--assets-min", type=int, default=2, help="Min assets touched per shift (default 2)")
    p.add_argument("--assets-max", type=int, default=5, help="Max assets touched per shift (default 5)")
    p.add_argument("--seed", type=int, default=42, help="Random seed, for a reproducible run (default 42)")
    p.add_argument(
        "--database-url",
        default=os.environ.get(
            "HISTORY_DATABASE_URL",
            "postgresql+asyncpg://sop:sop@localhost:5433/sop_opera_history",
        ),
        help="Target DB. Defaults to HISTORY_DATABASE_URL env or the local sop_opera_history DB. "
        "Never point this at the live demo DB (sop_opera) — see docs/track-a-tasks.md Phase 0 context.",
    )
    p.add_argument("--assessment-timeout", type=float, default=30.0, help="Seconds to poll one review's assessment before giving up (default 30)")
    p.add_argument("--handover-every-days", type=int, default=3, help="Attempt one shift handover every N simulated days (default 3, 0 disables)")
    p.add_argument(
        "--context-validity-minutes",
        type=float,
        default=2.0,
        help="Real-world (not simulated) minutes a context entry stays valid for fact "
        "derivation (default 2). The pipeline checks validity against real wall-clock "
        "time, not simulated time, and a whole corpus seeds in minutes — the schema "
        "default (+4 real hours) means NOTHING ever expires during the run, so facts "
        "accumulate without decay and every asset ends up permanently blocking. "
        "Measured at 150 days with the default: 43 elevated / 107 blocking, avg 4.7 "
        "simultaneously-true facts per blocking assessment (max 8) — none of which "
        "should still be 'true' by then even in real seconds, let alone simulated days.",
    )
    p.add_argument(
        "--cooldown-shifts",
        type=int,
        default=15,
        help="An asset touched this shift is excluded from selection for this many "
        "following shifts (default 15, ~5 simulated days at 3 shifts/day). Without "
        "this, 27 assets touched 2-5x/shift get re-touched dozens of times each over "
        "a year with no gap to resolve between events, so reopens stack multiple "
        "hazard dimensions onto the same review and the corpus tips blocking-majority "
        "instead of 'few blocking' — measured at 150 days: 42 elevated / 113 blocking.",
    )
    p.add_argument("--actor", default="seed:history", help="Audit actor label for seeded writes (default seed:history)")
    return p.parse_args()


ARGS = _parse_args()

# Must happen before any `app.*` import — app.db.session builds its engine
# from settings.database_url at module import time.
os.environ["DATABASE_URL"] = ARGS.database_url
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND))

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()
_settings = get_settings()
if "sop_opera_history" not in _settings.database_url and "history" not in _settings.database_url:
    print(
        f"REFUSING TO RUN: DATABASE_URL does not look like a history DB: {_settings.database_url}\n"
        "This script seeds through transition_review() at volume — pointing it at the live "
        "demo DB risks contaminating it with data no /demo/reset will clean up cleanly, and "
        "risks the reverse: /demo/reset wiping your seeded corpus mid-run. Pass --database-url "
        "explicitly if this is intentional.",
        file=sys.stderr,
    )
    if "--force" not in sys.argv:
        sys.exit(1)

from app.assessment.manual import list_assessments  # noqa: E402
from app.assessment.orchestrator import orchestrator  # noqa: E402
from app.audit.service import verify_audit_chain  # noqa: E402
from app.auth.schemas import ActorMeOut  # noqa: E402
from app.context.schemas import ContextIn  # noqa: E402
from app.context.service import ingest_context  # noqa: E402
from app.db.seed import ASSETS, OPERATORS  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.decisions.schemas import DecisionIn  # noqa: E402
from app.decisions.service import DecisionError, submit_decision  # noqa: E402
from app.handover.service import HandoverError, accept, acknowledge_item, issue, open_draft  # noqa: E402
from app.reviews.repository import transition_review  # noqa: E402
from app.reviews.state_machine import IllegalTransitionError, ReviewEvent  # noqa: E402

random.seed(ARGS.seed)

ASSET_IDS = [a[0] for a in ASSETS]
# Which metrics each asset actually instruments — ASSETS carries this already.
ASSET_SENSORS = {a[0]: list(a[4]) for a in ASSETS}
OPERATOR_ACTORS = [
    ActorMeOut(id=oid, kind="user", name=name, role=role, owned_zones=[])
    for oid, name, role in OPERATORS
]


# --- Injected plant regularities (W13) ---------------------------------------
"""
Three operational regularities, so the simulated plant is a plant rather than a
coin flip.

WHY THEY EXIST. Without them every reading is drawn independently from a fixed
distribution — `random_context_payload()` used to take no arguments at all — so
consecutive events on an asset, and events on different assets, are statistically
unrelated by construction. A miner looking for cross-event or cross-asset
structure in that corpus can only find sampling noise. These three give it
something real to recover, and let W13 be reported as *injected-signal
validation*: inject a known regularity, show the miner recovers it, quote the
recovery rate. That is a stronger claim than an unverifiable discovery.

THE DISCIPLINE, and it is the whole ballgame. Each regularity is a statement
about **who, when and where** — expressed only in raw sensor values, permit
paperwork, crew presence and PPE. None of them references a derived-fact name, a
hazard dimension, or a threshold. Plausible plant behaviour goes in;
`derived_facts.py` decides which facts fire and `risk/policy.py` decides the
verdict. Nothing here is tuned to produce a particular verdict, and no regularity
deliberately co-occurs facts across complementary hazard dimensions — that would
be engineering a pathway, which is exactly the circularity this is meant to
avoid.

DISCLOSURE, rather than hiding it. The author of this section had previously read
`risk/policy.py` in full, so unlike the distribution ranges below this block
cannot claim to be written blind to the rule set. Two mitigations, both visible
here: every regularity moves exactly ONE operational axis (crew behaviour, or
equipment condition, or which assets get inspected together), and none of them
was checked against the resulting verdict mix while being written. Before the
finals run it is worth having someone who has not read `risk/policy.py`
sanity-check that these read as plant behaviour rather than as rule bait.
"""

# Coke oven gas from the battery is cleaned downstream — a real process coupling,
# and the only asset pair here that shares a stream.
COKE_BATTERY_B = "66666666-6666-6666-6666-666666666662"
GAS_CLEANING_PLANT = "77777777-7777-7777-7777-777777777701"

# R3: when the battery is worked, how often the downstream plant is inspected in
# the same shift.
COUPLED_INSPECTION_P = 0.65

# First shift of the plant day. With 3 shifts that gives 06:00 / 14:00 / 22:00,
# so "the night shift" is a clock band anything reading the corpus can name.
SHIFT_START_HOUR = 6


@dataclass
class PlantState:
    """
    Equipment condition, carried across shifts — a plant has a memory, a coin
    flip does not.

    Deliberately independent of anything the platform concluded: an asset begins
    drifting on its own schedule and is repaired on its own schedule. Nothing
    here reads a review, a fact or a verdict, so the persistence the miner
    recovers is a property of the simulated plant rather than an echo of the
    rules.
    """

    # asset_id -> shift when this asset began drifting.
    degraded_since: dict = field(default_factory=dict)
    # asset_id -> which metric the degradation shows on. A failing bearing reads
    # on vibration every time; it does not wander to pH between inspections.
    degraded_metric: dict = field(default_factory=dict)
    # R3 — assets pulled into this shift as a downstream inspection.
    coupled_this_shift: set = field(default_factory=set)

    def degraded(self, asset_id: str, shift_num: int) -> bool:
        since = self.degraded_since.get(asset_id)
        return since is not None and shift_num - since <= DEGRADED_FOR_SHIFTS

    def tick(self, asset_id: str, shift_num: int) -> None:
        """Onset, or repair once the degradation has run its course."""
        since = self.degraded_since.get(asset_id)
        if since is None:
            if random.random() < DEGRADATION_ONSET_P:
                self.degraded_since[asset_id] = shift_num
                # Which subsystem is going. Drawn from what this asset actually
                # instruments, so the story stays physical.
                metrics = ASSET_SENSORS.get(asset_id) or ["temp"]
                self.degraded_metric[asset_id] = random.choice(metrics)
        elif shift_num - since > DEGRADED_FOR_SHIFTS:
            self.degraded_since.pop(asset_id, None)
            self.degraded_metric.pop(asset_id, None)


@dataclass(frozen=True)
class Conditions:
    """What is true of the plant when a reading is taken."""

    asset_id: str
    night: bool
    degraded: bool
    coupled: bool
    degraded_metric: str | None = None


# R4 — an asset with an unrepaired excursion is far likelier to show another one.
# Only ~55% of readings are sensor readings, so the observable effect on outcomes
# is roughly half whatever is set here.
DEGRADED_EXCURSION_P = 0.62
BASE_EXCURSION_P = 0.16
# How long a degradation persists before maintenance is assumed to have caught it.
# The asset cooldown puts ~15 shifts between events on one asset, so this has to
# span several of them or the condition is repaired before it is ever seen twice
# and the persistence is invisible. 75 shifts is ~25 simulated days — a plausible
# time-to-repair for a bad actor waiting on a shutdown window.
DEGRADED_FOR_SHIFTS = 75
# Chance a healthy asset begins drifting on any shift it is worked.
DEGRADATION_ONSET_P = 0.10


# --- Plausible-signal generator -------------------------------------------
# Wide/log-spread on purpose (see DISTRIBUTION NOTE above). Weighted so most
# readings read as unremarkable and a minority carry a real excursion.

def _sensor_reading(c: Conditions) -> tuple[str, dict]:
    kind = random.choices(
        ["gas", "temp", "vibration", "ph", "level"],
        weights=[35, 30, 15, 10, 10],
    )[0]
    # R4 — a degrading subsystem is what the round is checking, so the reading
    # usually lands on the metric that is going.
    if c.degraded and c.degraded_metric and random.random() < 0.75:
        kind = c.degraded_metric
    # Severity is deliberately mild-skewed: on a real plant the large majority of
    # "off-normal" readings are minor drifts an operator glances at and moves on
    # from, not emergencies. The first spike run made every excursion severe and
    # produced a corpus with zero low-severity reviews, which read as implausible.
    # R4 — equipment condition. An asset that has already drifted and has not been
    # repaired keeps drifting; that is the whole reason plants run maintenance
    # rounds. This is the only axis this regularity touches.
    p_excursion = DEGRADED_EXCURSION_P if c.degraded else BASE_EXCURSION_P
    # R3 — this reading is a downstream inspection prompted by work on the
    # battery upstream, so it is being taken *because* something looked off.
    if c.coupled:
        p_excursion = max(p_excursion, 0.50)
    excursion = random.random() < p_excursion
    spike = excursion and random.random() < 0.15  # a minority of those go badly wrong

    if kind == "gas":
        value = random.uniform(1, 14) if not excursion else random.uniform(45, 90) if spike else random.uniform(15, 32)
        return "sensor", {"gas_reading": round(value, 1), "unit": "ppm"}
    if kind == "temp":
        value = random.uniform(25, 65) if not excursion else random.uniform(115, 160) if spike else random.uniform(68, 95)
        return "sensor", {"temp_reading": round(value, 1), "unit": "C"}
    if kind == "vibration":
        value = random.uniform(0.5, 4.5) if not excursion else random.uniform(9, 15) if spike else random.uniform(5, 8)
        return "sensor", {"vibration_mm_s": round(value, 2)}
    if kind == "ph":
        value = random.uniform(6.3, 8.6) if not excursion else random.choice([random.uniform(4.5, 6.0), random.uniform(9.0, 10.5)])
        return "sensor", {"ph": round(value, 2)}
    value = random.uniform(15, 85) if not excursion else random.choice([random.uniform(0, 6), random.uniform(94, 100)])
    return "sensor", {"level_pct": round(value, 1)}


def _permit_reading(c: Conditions) -> tuple[str, dict]:
    # Same gating discipline as _sensor_reading(): most permit activity is
    # routine paperwork, not a live hot-work/confined-space permit. The first
    # 150-day run at scale had NO severity gate here at all — 45% of every
    # permit reading was hot_work/confined_space, ~31% of ALL permit readings
    # looked like an active risky permit, dwarfing the sensor excursion rate —
    # and that flipped the corpus from "few blocking" to blocking-majority.
    notable = random.random() < 0.15
    if not notable:
        work_type = "cold_work"
        status = random.choices(["active", "closed"], weights=[60, 40])[0]
    else:
        work_type = random.choices(["hot_work", "confined_space"], weights=[65, 35])[0]
        status = random.choices(["active", "pending"], weights=[70, 30])[0]
    return "permit", {"permit_id": f"PTW-{random.randint(1000, 9999)}", "status": status, "work_type": work_type}


def _worker_location_reading(c: Conditions) -> tuple[str, dict]:
    # R1 — crew behaviour on the night shift. Thinner supervision and fatigue put
    # people in hazardous zones more often. Deliberately the only axis R1 moves:
    # spreading a night effect across unrelated axes would be assembling a hazard
    # pathway by hand rather than describing a shift.
    hazardous_w = 38 if c.night else 15
    zone = random.choices(["safe", "hazardous"], weights=[100 - hazardous_w, hazardous_w])[0]
    worker_id = random.choice(
        [
            "55555555-5555-5555-5555-555555555551",
            "55555555-5555-5555-5555-555555555552",
            "55555555-5555-5555-5555-555555555553",
            "55555555-5555-5555-5555-555555555554",
            "55555555-5555-5555-5555-555555555555",
        ]
    )
    return "worker_location", {"worker_id": worker_id, "zone": zone}


def _ppe_reading(c: Conditions) -> tuple[str, dict]:
    # R1, same shift story: PPE discipline slips on nights.
    compliant = random.random() < (0.60 if c.night else 0.85)
    payload = {"worker_id": "55555555-5555-5555-5555-555555555551", "compliant": compliant}
    if not compliant:
        payload["missing"] = random.choice(["helmet", "gas_mask", "gloves"])
    return "ppe_status", payload


def _weather_reading(c: Conditions) -> tuple[str, dict]:
    wind = random.uniform(1, 12) if random.random() > 0.1 else random.uniform(12, 22)
    return "weather", {"wind_ms": round(wind, 1), "lightning": random.random() < 0.03}


_GENERATORS = [
    (_sensor_reading, 55),
    (_permit_reading, 15),
    (_worker_location_reading, 15),
    (_ppe_reading, 10),
    (_weather_reading, 5),
]


def random_context_payload(c: Conditions) -> tuple[str, dict]:
    gens, weights = zip(*_GENERATORS)
    return random.choices(gens, weights=weights)[0](c)


# --- Outcome policy (decision-time, not fact-time) --------------------------
# Weighted by the *real* risk_level the system produced — not chosen by us.

def pick_outcome(risk_level: str | None) -> str:
    if risk_level == "blocking":
        # decisions/service.py enforces this: a blocking assessment can only be
        # closed with outcome=blocked. Learned the hard way — first spike run
        # crashed on this exact validation.
        return "blocked"
    if risk_level == "elevated":
        return random.choices(["approved_with_conditions", "approved", "blocked"], weights=[60, 30, 10])[0]
    return random.choices(["approved", "approved_with_conditions"], weights=[92, 8])[0]


@dataclass
class Tally:
    reviews_created: int = 0
    reviews_closed: int = 0
    assessment_failed: int = 0
    assessment_timeout: int = 0
    by_risk_level: dict = field(default_factory=dict)
    by_outcome: dict = field(default_factory=dict)
    # review_id -> simulated timestamp, for the backdating pass. Also de-dupes:
    # handle_context_change() can hand back an *existing* review it re-triggered,
    # so counting every 'assessing' result would double-count one review.
    sim_times: dict = field(default_factory=dict)
    # review_id -> one sim time per closure, in closure order. A review reopened
    # and re-closed six times over a year is six operational events at six
    # different moments; keeping only the first collapses them onto one day, and
    # anything reading the corpus as a time series (W11b's month views, W13's
    # cross-event and shift mining) then sees a year as a handful of instants.
    closure_sim_times: dict = field(default_factory=dict)
    reviews_reopened: int = 0
    race_skipped: int = 0
    handovers_opened: int = 0
    handovers_issued: int = 0
    handovers_accepted: int = 0
    handover_errors: int = 0
    # handover_id -> simulated timestamp, for the backdating pass.
    handover_sim_times: dict = field(default_factory=dict)


async def _wait_for_terminal_assessment(review_id, timeout_s: float) -> dict | None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        async with SessionLocal() as session:
            rows = await list_assessments(session, review_id)
        if rows and rows[0]["status"] in ("complete", "failed"):
            return rows[0]
        await asyncio.sleep(0.2)
    return None


async def retire_stale_context(asset_id: str) -> None:
    """
    Age off the asset's previous readings before taking new ones.

    THE PROBLEM THIS SOLVES. Context validity is set in *real* time
    (--context-validity-minutes, default +4 real hours) while this script
    compresses a simulated year into a few real minutes. Nothing ever expires
    mid-run, so every asset accumulates facts monotonically: measured at 365
    days, average facts per closure climbed 1.7 -> 7.4 over five months and
    plateaued near 7, the corpus came out 362 blocking / 22 elevated / 0 nominal,
    and *every* fact type showed recurrence — including ones no regularity
    touches — because once a fact fired it stayed true forever. "The condition
    is back at the next inspection" was tautological rather than a statement
    about the plant.

    Roughly five simulated days pass between events on one asset (the cooldown).
    A reading valid for four hours is long dead by then, so the honest thing is
    to retire it. Same shape as the DELETE in simulator/engine.py:73, which
    matches facts through the context entries that produced them.

    This is what makes recurrence meaningful: the condition has to be produced
    again by the plant (R4's degradation model), not merely left lying around.
    """
    from sqlalchemy import text

    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                UPDATE context_entries
                   SET valid_until = now() - interval '1 second'
                 WHERE asset_id = CAST(:aid AS uuid)
                   AND valid_until > now()
                """
            ),
            {"aid": asset_id},
        )
        # Facts outlive their context otherwise: the assessment path reads
        # DISTINCT ON (fact_type) ... ORDER BY computed_at DESC with no validity
        # filter, so a stale row would keep being read as current.
        await session.execute(
            text("DELETE FROM derived_facts WHERE asset_id = CAST(:aid AS uuid)"),
            {"aid": asset_id},
        )
        await session.commit()


async def seed_one_review(
    asset_id: str, tally: Tally, sim_time: datetime, c: Conditions
) -> "UUID | None":
    await retire_stale_context(asset_id)
    category, payload = random_context_payload(c)

    async with SessionLocal() as session:
        result = await ingest_context(
            session,
            ContextIn(
                asset_id=asset_id,
                category=category,
                payload=payload,
                provider="seed:history",
                valid_until=datetime.now(timezone.utc) + timedelta(minutes=ARGS.context_validity_minutes),
            ),
        )

    if result.review is None:
        # No new/re-triggered review (facts didn't warrant one) — a normal,
        # expected outcome for most shifts. Nothing to progress.
        return

    review_id = result.review.id
    if result.review.state != "assessing":
        # Re-triggered but landed somewhere other than assessing — nothing this
        # pass can progress; leave it for a future touch.
        return None

    reopened = review_id in tally.sim_times
    if reopened:
        # A previously-closed review, touched again later and legitimately
        # reopened (should_reopen_after_decision) — NOT a transient re-trigger.
        # This is expected and common over a simulated year: don't skip it, or
        # every asset eventually accumulates one permanently-stuck open review
        # and the whole corpus silently stops growing (this happened for real —
        # by shift 220 all 27 assets had one stuck at pending_decision and
        # reviews_created froze for the rest of a 1095-shift run).
        # Keep the *original* sim_time for backdating (reviews.created_at must
        # stay at first-opened), just don't recount it as newly created.
        tally.reviews_reopened += 1
    else:
        tally.sim_times[review_id] = sim_time
        tally.reviews_created += 1

    assessment = await _wait_for_terminal_assessment(review_id, ARGS.assessment_timeout)
    if assessment is None:
        tally.assessment_timeout += 1
        return None
    if assessment["status"] == "failed":
        tally.assessment_failed += 1
        return None

    risk_level = assessment.get("risk_level")
    tally.by_risk_level[risk_level] = tally.by_risk_level.get(risk_level, 0) + 1

    outcome = pick_outcome(risk_level)
    dispositions = {r["id"]: "accepted" for r in assessment.get("recommendations", [])}

    # Defensive: an unattended year-long run should survive a rare race (e.g.
    # a later shift re-triggering this same asset's review between our poll
    # and our decide call) rather than crash the whole corpus over one row.
    # Structurally this shouldn't happen anymore now that no review is ever
    # deliberately left open across shift boundaries — kept as a safety net,
    # not a substitute for that fix (see git history: it fired for real once).
    try:
        async with SessionLocal() as session:
            await submit_decision(
                session,
                review_id,
                DecisionIn(outcome=outcome, recommendation_dispositions=dispositions, conditions="Seeded decision" if outcome != "approved" else None),
                actor=ARGS.actor,
            )
        async with SessionLocal() as session:
            await transition_review(session, review_id, ReviewEvent.CLOSE, ARGS.actor)
    except (DecisionError, IllegalTransitionError) as exc:
        tally.race_skipped += 1
        print(f"  [race, skipped] review {review_id}: {exc}")
        return review_id

    tally.reviews_closed += 1
    tally.closure_sim_times.setdefault(review_id, []).append(sim_time)
    tally.by_outcome[outcome] = tally.by_outcome.get(outcome, 0) + 1
    return review_id


async def seed_one_handover(day_idx: int, tally: Tally, sim_time: datetime) -> None:
    """
    Draft -> issue -> (partially) acknowledge -> maybe accept a shift handover
    between the two seeded panel operators, alternating who's outgoing.

    open_draft() composes carry-forward content from *currently* open reviews/
    tasks (compose_carry_forward reads live state, not a point in the past) —
    that's why the caller times this right after deliberately leaving one
    review open (see main()'s day-boundary logic). A handover fired with
    nothing open is still a valid, realistic row (a quiet shift), so this
    doesn't skip if there's no content.
    """
    outgoing, incoming = (
        (OPERATOR_ACTORS[0], OPERATOR_ACTORS[1])
        if day_idx % 2 == 0
        else (OPERATOR_ACTORS[1], OPERATOR_ACTORS[0])
    )
    window_hours = int(24 / ARGS.shifts_per_day) * ARGS.handover_every_days

    try:
        async with SessionLocal() as session:
            handover = await open_draft(
                session, actor=outgoing, incoming_actor_id=incoming.id, window_hours=window_hours
            )
    except (HandoverError, LookupError):
        tally.handover_errors += 1
        return

    tally.handovers_opened += 1
    tally.handover_sim_times[handover.id] = sim_time

    # ~30% of handovers are left mid-draft on purpose (an abandoned handover
    # is itself a meaningful, realistic failure mode — see service.py's own
    # comment on expire_stale_active()). The rest get issued.
    if random.random() < 0.30:
        return

    try:
        async with SessionLocal() as session:
            issued = await issue(session, handover_id=handover.id, actor=outgoing)
    except HandoverError:
        return
    tally.handovers_issued += 1

    required_items = [i for i in issued.items if i.requires_ack]
    complete_run = random.random() < 0.65  # rest leave >=1 item pending on purpose
    acknowledged_all = True
    for item in required_items:
        if not complete_run and random.random() < 0.4:
            acknowledged_all = False
            continue
        ack_state = random.choices(["acknowledged", "queried"], weights=[85, 15])[0]
        try:
            async with SessionLocal() as session:
                await acknowledge_item(
                    session,
                    handover_id=handover.id,
                    item_id=item.id,
                    ack_state=ack_state,
                    note=None,
                    actor=incoming,
                )
        except (HandoverError, LookupError):
            acknowledged_all = False

    if acknowledged_all:
        try:
            async with SessionLocal() as session:
                await accept(session, handover_id=handover.id, actor=incoming)
            tally.handovers_accepted += 1
        except HandoverError:
            pass


async def backdate_corpus(tally: Tally) -> int:
    """
    Spread the seeded corpus across the simulated window.

    Everything is written at real wall-clock time by the normal write path, so
    without this every "year" of history lands in one afternoon and W11b's
    over-time views (blocking verdicts by month, mean lead time by month) have
    nothing to plot.

    DELIBERATELY DOES NOT TOUCH `audit_entries`. Each audit row's hash is computed
    over its own `recorded_at` (audit/chain.py), so rewriting those timestamps
    would invalidate every entry_hash and break `verify_audit_chain()` — and
    re-deriving the chain is exactly what audit/service.py's single-writer rule
    exists to prevent. The audit trail therefore honestly records when these rows
    were written to this demonstration database, while the business timestamps
    carry the simulated plant timeline. That gap is a property of a seeded corpus
    and is why W11c's "demonstration corpus" labelling is non-negotiable.

    Closure reports are backdated individually, each to the moment that closure
    actually happened — see Tally.closure_sim_times. `reviews.created_at` still
    marks first-opened, which is what it means.

    KNOWN SIMPLIFICATION: a reopened review (see reviews_reopened in seed_one_review)
    can have a second decisions/reports row for the same review_id (legitimate —
    reports.closure_event_seq exists precisely for this). This pass backdates by
    review_id, so both cycles land on the same simulated day rather than the
    reopen landing genuinely later. Causally harmless (ordering within each row
    stays correct) but not perfectly realistic — acceptable for Phase 2's scope,
    worth revisiting if W11b's month-over-month views end up needing it.
    """
    if not tally.sim_times:
        return 0

    updated = 0
    async with SessionLocal() as session:
        from sqlalchemy import text

        for review_id, sim_time in tally.sim_times.items():
            params = {"rid": str(review_id), "t": sim_time}
            # Offset used to shift child rows that hang off this review, so a
            # decision still lands after its review opened, etc.
            await session.execute(
                text(
                    """
                    UPDATE reviews
                       SET created_at = CAST(:t AS timestamptz),
                           closed_at  = CASE WHEN closed_at IS NOT NULL
                                             THEN CAST(:t AS timestamptz) + (closed_at - created_at)
                                        END
                     WHERE id = CAST(:rid AS uuid)
                    """
                ),
                params,
            )
            for stmt in (
                """UPDATE assessments SET created_at = CAST(:t AS timestamptz) + interval '2 minutes'
                    WHERE review_id = CAST(:rid AS uuid)""",
                """UPDATE decisions SET submitted_at = CAST(:t AS timestamptz) + interval '18 minutes'
                    WHERE review_id = CAST(:rid AS uuid)""",
                """UPDATE review_tasks SET created_at = CAST(:t AS timestamptz) + interval '20 minutes'
                    WHERE review_id = CAST(:rid AS uuid)""",
                """UPDATE context_entries SET valid_from = CAST(:t AS timestamptz),
                          valid_until = CAST(:t AS timestamptz) + interval '4 hours'
                    WHERE id IN (SELECT unnest(source_context_ids) FROM derived_facts
                                  WHERE asset_id = (SELECT asset_id FROM reviews
                                                     WHERE id = CAST(:rid AS uuid)))""",
                """UPDATE incidents SET reported_at = CAST(:t AS timestamptz) + interval '30 minutes'
                    WHERE CAST(:rid AS uuid) = ANY(linked_review_ids)""",
            ):
                await session.execute(text(stmt), params)
            updated += 1

        # Each closure to the moment it actually happened, ordered by
        # closure_event_seq so the Nth report gets the Nth close's sim time.
        for review_id, times in tally.closure_sim_times.items():
            rows = await session.execute(
                text(
                    """
                    SELECT id FROM reports
                     WHERE review_id = CAST(:rid AS uuid)
                     ORDER BY closure_event_seq
                    """
                ),
                {"rid": str(review_id)},
            )
            for report_row, closed_at in zip(rows.fetchall(), times):
                await session.execute(
                    text(
                        """
                        UPDATE reports
                           SET generated_at = CAST(:t AS timestamptz) + interval '25 minutes',
                               frozen_at    = CAST(:t AS timestamptz) + interval '25 minutes'
                         WHERE id = CAST(:id AS uuid)
                        """
                    ),
                    {"id": str(report_row._mapping["id"]), "t": closed_at},
                )

        for handover_id, sim_time in tally.handover_sim_times.items():
            params = {"hid": str(handover_id), "t": sim_time}
            await session.execute(
                text(
                    """
                    UPDATE handovers
                       SET created_at   = CAST(:t AS timestamptz),
                           window_start = CAST(:t AS timestamptz) - (window_end - window_start),
                           window_end   = CAST(:t AS timestamptz),
                           issued_at    = CASE WHEN issued_at IS NOT NULL
                                               THEN CAST(:t AS timestamptz) + interval '5 minutes' END,
                           accepted_at  = CASE WHEN accepted_at IS NOT NULL
                                               THEN CAST(:t AS timestamptz) + interval '40 minutes' END
                     WHERE id = CAST(:hid AS uuid)
                    """
                ),
                params,
            )
            await session.execute(
                text(
                    """
                    UPDATE handover_items
                       SET created_at = CAST(:t AS timestamptz),
                           acknowledged_at = CASE WHEN acknowledged_at IS NOT NULL
                                                  THEN CAST(:t AS timestamptz) + interval '20 minutes' END
                     WHERE handover_id = CAST(:hid AS uuid)
                    """
                ),
                params,
            )
        await session.commit()
    return updated


async def main() -> None:
    print(f"Seeding against: {_settings.database_url}")
    print(f"days={ARGS.days} shifts_per_day={ARGS.shifts_per_day} assets_per_shift=[{ARGS.assets_min},{ARGS.assets_max}] seed={ARGS.seed}")

    orchestrator.start()
    await asyncio.sleep(0.3)  # let the worker loop actually come up

    tally = Tally()
    t0 = time.monotonic()
    total_shifts = ARGS.days * ARGS.shifts_per_day
    last_touched: dict = {}  # asset_id -> shift_num last touched, for the cooldown
    plant = PlantState()

    # Simulated clock: the corpus is presented as the `--days` window ending today.
    #
    # Snapped to a real shift boundary. Shifts are exactly 24/shifts_per_day hours
    # apart, so an unsnapped window_end would put every shift on an arbitrary
    # clock phase — the night shift would land at, say, 04:00-12:00, and anything
    # reading these timestamps back could only report "events between 04:00 and
    # 12:00" instead of naming the shift. Plants run 06:00 / 14:00 / 22:00.
    shift_hours = 24 / ARGS.shifts_per_day
    _now = datetime.now(timezone.utc)
    _boundary = SHIFT_START_HOUR % int(shift_hours)
    _hour = ((_now.hour - _boundary) // int(shift_hours)) * int(shift_hours) + _boundary
    window_end = _now.replace(hour=_hour % 24, minute=0, second=0, microsecond=0)

    try:
        for shift_num in range(total_shifts):
            shifts_ago = total_shifts - shift_num
            sim_time = window_end - timedelta(hours=shifts_ago * shift_hours)
            day_idx = shift_num // ARGS.shifts_per_day
            is_last_shift_of_day = (shift_num + 1) % ARGS.shifts_per_day == 0
            fires_handover = (
                ARGS.handover_every_days > 0
                and is_last_shift_of_day
                and (day_idx + 1) % ARGS.handover_every_days == 0
            )

            n_assets = random.randint(ARGS.assets_min, ARGS.assets_max)
            eligible = [
                a for a in ASSET_IDS
                if shift_num - last_touched.get(a, -10**9) > ARGS.cooldown_shifts
            ]
            pool = eligible if len(eligible) >= n_assets else ASSET_IDS  # fallback if cooldown starves the pool
            touched = random.sample(pool, k=min(n_assets, len(pool)))

            # R3 — working the battery prompts a downstream inspection of the gas
            # cleaning plant on the same shift. The cooldown is deliberately not
            # consulted: a process coupling does not wait its turn.
            plant.coupled_this_shift = set()
            if COKE_BATTERY_B in touched and random.random() < COUPLED_INSPECTION_P:
                if GAS_CLEANING_PLANT not in touched:
                    touched.append(GAS_CLEANING_PLANT)
                plant.coupled_this_shift.add(GAS_CLEANING_PLANT)

            # R4 — advance equipment condition before anything is read. This is a
            # plant model, not a reaction to what the rules said: an asset starts
            # drifting on its own schedule and stays drifted until maintenance.
            for asset_id in touched:
                plant.tick(asset_id, shift_num)

            # Night is the last shift of the day.
            shift_idx = shift_num % ARGS.shifts_per_day
            night = shift_idx == ARGS.shifts_per_day - 1

            for asset_id in touched:
                last_touched[asset_id] = shift_num
                # Jitter within the shift so rows don't all share one timestamp.
                jittered = sim_time + timedelta(minutes=random.randint(0, int(shift_hours * 60) - 1))
                degraded = plant.degraded(asset_id, shift_num)
                cond = Conditions(
                    asset_id=asset_id,
                    night=night,
                    degraded=degraded,
                    coupled=asset_id in plant.coupled_this_shift,
                    degraded_metric=plant.degraded_metric.get(asset_id),
                )
                await seed_one_review(asset_id, tally, jittered, cond)

            if fires_handover:
                await seed_one_handover(day_idx, tally, sim_time)
            if (shift_num + 1) % 10 == 0 or shift_num == total_shifts - 1:
                elapsed = time.monotonic() - t0
                print(
                    f"  shift {shift_num + 1}/{total_shifts} | {elapsed:6.1f}s elapsed | "
                    f"reviews created={tally.reviews_created} closed={tally.reviews_closed} "
                    f"failed={tally.assessment_failed} timeout={tally.assessment_timeout} | "
                    f"handovers opened={tally.handovers_opened} accepted={tally.handovers_accepted}"
                )
    finally:
        orchestrator.stop()

    elapsed = time.monotonic() - t0

    print("\n=== Seed run summary ===")
    print(f"Wall-clock: {elapsed:.1f}s for {ARGS.days} simulated days ({total_shifts} shifts)")
    if ARGS.days > 0:
        per_day = elapsed / ARGS.days
        print(f"  -> {per_day:.2f}s/simulated-day  ->  365-day extrapolation: {per_day * 365 / 60:.1f} minutes")
    print(f"Reviews created:        {tally.reviews_created}")
    print(f"Reviews reopened:       {tally.reviews_reopened}  (closed earlier, touched again later — decided+closed afresh)")
    print(f"Reviews closed:         {tally.reviews_closed}")
    print(f"Race-skipped:           {tally.race_skipped}  (state moved on before decide/close; a stray review remains open, not fatal)")
    print(f"Assessment failed:      {tally.assessment_failed}")
    print(f"Assessment timed out:   {tally.assessment_timeout}")
    print(f"By risk_level:          {tally.by_risk_level}")
    print(f"By outcome:             {tally.by_outcome}")
    print(f"Handovers opened:       {tally.handovers_opened}")
    print(f"Handovers issued:       {tally.handovers_issued}")
    print(f"Handovers accepted:     {tally.handovers_accepted}  (rest left issued-pending or draft, on purpose)")
    print(f"Handover errors:        {tally.handover_errors}")

    print("\n=== Backdating corpus across the simulated window ===")
    backdated = await backdate_corpus(tally)
    print(f"Backdated {backdated} reviews (+ their assessments/decisions/reports/tasks/incidents).")
    print("audit_entries deliberately left at real write time — see backdate_corpus() docstring.")

    print("\n=== Audit chain verification (must still be intact after backdating) ===")
    async with SessionLocal() as session:
        verification = await verify_audit_chain(session)
    print(verification)


if __name__ == "__main__":
    asyncio.run(main())
