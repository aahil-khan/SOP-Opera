#!/usr/bin/env python3
"""
Quick mock-data seeder — throwaway, for fast visual QA of report quality.

Deliberately separate from scripts/seed_history.py. That script routes every
write through the real service layer (ingest_context -> transition_review ->
submit_decision), which is what makes it audit-chain-valid and safe for the
finals corpus. This script skips all of that: raw SQL INSERTs straight into
the tables, no orchestrator, no assessment pipeline, no audit_entries. It
exists purely to let you eyeball report quality fast, before committing to a
real run.

Because there's no live fact-derivation to fight, every timestamp is written
explicitly at insert time — no post-hoc backdating pass needed, and none of
seed_history.py's real-time-vs-simulated-time problems apply here.

Usage:
    .venv/Scripts/python.exe scripts/quick_mock_seed.py --days 7 --seed 1

Target: the PRIMARY database (sop_opera) — same DB the live app reads,
alongside whatever real data already exists there. Every row this script
writes is tagged reviews.is_seeded = TRUE, so it can live next to real data
without being confused for it. The "seeded mode" toggle in the UI (GET/POST
/demo/seeded-mode) is a query filter on that flag: off shows only real rows,
on shows real + mock together. This is NOT the old dual-database design —
there is no second connection at request time, just a tagged row in one place.

The wipe step is scoped to is_seeded = TRUE only (a targeted, dependency-ordered
DELETE, not a blanket TRUNCATE) — real data is never touched by this script,
by construction, regardless of how many times you re-run it.
"""

from __future__ import annotations

import argparse
import asyncio
import math
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--days", type=int, default=7, help="Simulated days to cover (default 7)")
    p.add_argument(
        "--total",
        type=int,
        default=None,
        help="Exact number of reviews to generate. Distributed across the --days window "
        "using realistic day weighting (weekday/weekend, seasonal), rather than a flat "
        "spread. Overrides --reviews-per-week when given.",
    )
    p.add_argument(
        "--reviews-per-week",
        type=float,
        default=7.5,
        help="Target average reviews/week (default 7.5), used when --total is not given. "
        "Daily count is drawn from a Poisson distribution around this rate — real safety "
        "events don't arrive on a schedule, so some days have none and some have three.",
    )
    p.add_argument("--seed", type=int, default=1)
    p.add_argument(
        "--database-url",
        default=os.environ.get(
            "DATABASE_URL",
            "postgresql+asyncpg://sop:sop@localhost:5433/sop_opera",
        ),
        help="Defaults to the primary DB — same one the running app reads.",
    )
    return p.parse_args()


ARGS = _parse_args()

os.environ["DATABASE_URL"] = ARGS.database_url
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(BACKEND))

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()
_settings = get_settings()

from sqlalchemy import text  # noqa: E402

from app.db.seed import ASSETS, OWNER_ID, WORKERS  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.reports.packet import PACKET_VERSION, packet_hash  # noqa: E402

random.seed(ARGS.seed)

ASSET_BY_ID = {a[0]: {"id": a[0], "name": a[1], "zone": a[2], "floor": a[3]} for a in ASSETS}
ASSET_IDS = list(ASSET_BY_ID)

# Multiple supervisor identities, not just the one seeded decision-maker — a
# single name deciding 400 reviews across a year reads as obviously synthetic.
# Rajesh (OWNER_ID) is the real seeded user; the other two are new rows this
# script inserts (fixed UUIDs, idempotent via ON CONFLICT DO NOTHING).
SUPERVISORS = [
    {"id": OWNER_ID, "name": "Rajesh (Shift Supervisor)", "role": "decision_maker"},
    {"id": "99999999-9999-9999-9999-999999999991", "name": "Kavita Reddy (Shift Supervisor)", "role": "decision_maker"},
    {"id": "99999999-9999-9999-9999-999999999992", "name": "Sanjay Kulkarni (Shift Supervisor)", "role": "decision_maker"},
]

# Field workers who *raise* a fraction of reviews (origin='operator' rather
# than system-triggered), so their names appear in the corpus alongside the
# supervisors who decide. Deliberately the `workers` table, not the two panel
# operators in `users`: reviews.raised_by_worker_id has an FK to workers(id),
# so a users-table UUID here would fail the constraint outright.
OPERATOR_ACTORS = [{"id": wid, "name": name, "role": "field_operator"} for wid, name, _certs in WORKERS]

# A real plant's record is overwhelmingly routine: most shifts, nothing happens.
# This used to be {"elevated": 85, "blocking": 15} with no nominal branch at all,
# so every review in the corpus was elevated or blocking. On its own that was a
# footnote; the moment anything charts the corpus it stops being one — "verdicts
# over time" becomes a flat wall of elevated, which anyone who has seen a plant
# dashboard reads as generated data. The elevated:blocking ratio inside the
# non-nominal remainder is unchanged at 85:15.
RISK_WEIGHTS = {"nominal": 76, "elevated": 20, "blocking": 4}

# --- Realism shaping -------------------------------------------------------
# A real plant's incident record is not uniform. Three things shape it, and
# all three are modelled below because their absence is what makes generated
# data read as generated: process areas generate far more safety events than
# offices; events cluster in the working day; and weekends/holidays are quiet.

# Relative event likelihood per asset zone. Hot, pressurised, gas-handling and
# lifting areas dominate a real incident log; control rooms and offices barely
# appear. Weights are plausible-plant judgement, not derived from the rule set.
_ZONE_WEIGHTS = {
    "coke-oven-battery": 10.0, "gas-cleaning": 9.0, "dri-plant": 8.0,
    "byproduct-plant": 7.0, "boiler-house": 6.5, "tank-farm": 6.0,
    "compressor-yard": 5.5, "etp": 4.5, "pump-house": 4.0, "crane-deck": 4.0,
    "conveyor-gantry": 3.5, "furnace": 3.5, "hazardous": 3.5,
    "raw-material-yard": 3.0, "pipe-rack": 3.0, "workshop": 2.5,
    "fire-water": 2.0, "substation": 2.0, "weighbridge": 1.8,
    "cooling-towers": 1.8, "instrument-air": 1.5, "hvac": 1.2,
    "muster-point": 1.0, "control-room": 0.8, "central-control": 0.6,
    "scada": 0.5, "admin-office": 0.4,
}
_ASSET_WEIGHTS = [_ZONE_WEIGHTS.get(ASSET_BY_ID[a]["zone"], 2.0) for a in ASSET_IDS]

# Shift structure: day shift runs the most work, so it sees the most events.
# (start_hour, span_hours, weight)
_SHIFTS = [(6, 8, 0.50), (14, 8, 0.32), (22, 8, 0.18)]

# Weekend maintenance windows are lighter; Monday runs slightly hot as the
# week's work restarts. Index 0 = Monday.
_WEEKDAY_WEIGHTS = [1.15, 1.0, 1.0, 1.0, 0.95, 0.6, 0.5]

# Indian steel-plant summer (Apr–Jun) drives more heat/gas excursions; the
# monsoon and winter months are calmer. Index 0 = January.
_MONTH_WEIGHTS = [0.85, 0.9, 1.05, 1.25, 1.35, 1.2, 1.0, 0.95, 0.95, 1.0, 0.9, 0.85]

_CONDITIONS_POOL = [
    "Resume only after gas test confirms two consecutive clear readings.",
    "Continuous atmospheric monitoring for the remainder of the shift.",
    "Standby fire watch posted until the permit is closed.",
    "Re-verify isolation with the area authority before restart.",
    "Restrict access to essential personnel; log every entry.",
    "Conditions logged for shift handover; incoming operator to re-check on arrival.",
    "Escalate to the area supervisor if the reading does not fall within 30 minutes.",
    "Additional ventilation to run until levels return to normal band.",
]

_COMMENT_POOL = [
    "Verified on the floor before signing off.",
    "Cross-checked against the previous shift's log — same asset flagged twice this week.",
    "Reading confirmed by a second handheld instrument.",
    "Discussed with the area authority; agreed on the conditions below.",
    "Permit holder briefed directly.",
    None, None, None,  # most decisions carry no free-text comment
]

_REC_BY_RISK = {
    "nominal": [
        "No action required; continue the normal monitoring round.",
        "Conditions within limits — close with the routine check logged.",
        "Nothing to action; record the round and carry on.",
        "Routine round complete; no follow-up raised.",
    ],
    "blocking": [
        "Halt work and re-verify isolation before resuming.",
        "Stop the activity, evacuate the immediate zone, and re-test the atmosphere.",
        "Suspend the permit until the control failure is corrected and re-verified.",
        "Cease hot work; do not restart until a clear gas test is recorded.",
    ],
    "elevated": [
        "Continue with heightened monitoring and log a follow-up check.",
        "Maintain the activity under continuous supervision; re-check in 30 minutes.",
        "Proceed with additional ventilation and a posted fire watch.",
        "Allow work to continue; schedule an inspection before the next shift.",
        "Keep the permit open but re-confirm controls at the next handover.",
    ],
}


def _pick_timestamp(day_start: datetime) -> datetime:
    """
    A time-of-day drawn from the shift pattern, not uniform across 24h.

    The night shift is wrapped into the same calendar day (22:00-24:00 or
    00:00-06:00) rather than allowed to run past midnight. Letting it spill
    forward silently moved ~18% of every day's events onto the next date,
    which flattened the weekday/weekend weighting this function exists to
    produce — Monday drained into Tuesday and weekends stopped looking quiet.
    """
    start_h, span_h, _ = random.choices(_SHIFTS, weights=[s[2] for s in _SHIFTS])[0]
    hour = (start_h + random.random() * span_h) % 24
    return day_start + timedelta(hours=hour, minutes=random.uniform(0, 59))


def _day_weight(day: datetime) -> float:
    return _WEEKDAY_WEIGHTS[day.weekday()] * _MONTH_WEIGHTS[day.month - 1]

# --- Story templates ---------------------------------------------------------
# Each entry: fact_type -> (headline, detail_fn(asset_name) -> str, context category/payload_fn)
_STORIES = {
    "elevated_gas": {
        "headline": "Elevated gas",
        "detail": lambda a: f"Gas reading {random.randint(22, 44)} ppm exceeds the 20 ppm action threshold on {a}.",
        "category": "sensor",
        "payload": lambda: {"gas_reading": round(random.uniform(22, 44), 1), "unit": "ppm"},
        "reg_hint": "gas",
    },
    "over_temperature": {
        "headline": "Over temperature",
        "detail": lambda a: f"Temperature reading {random.randint(85, 108)}°C exceeds the normal operating band on {a}.",
        "category": "sensor",
        "payload": lambda: {"temp_reading": round(random.uniform(85, 108), 1), "unit": "C"},
        "reg_hint": "temperature",
    },
    "incomplete_isolation": {
        "headline": "Incomplete isolation",
        "detail": lambda a: f"Active permit on {a} shows isolation steps not yet fully verified.",
        "category": "permit",
        "payload": lambda: {"permit_id": f"PTW-{random.randint(1000,9999)}", "status": "active", "work_type": "confined_space"},
        "reg_hint": "isolation",
    },
    "permit_conflict": {
        "headline": "Permit conflict",
        "detail": lambda a: f"Concurrent hot-work and cold-work permits registered against {a} without a documented deconfliction.",
        "category": "permit",
        "payload": lambda: {"permit_id": f"PTW-{random.randint(1000,9999)}", "status": "active", "work_type": "hot_work"},
        "reg_hint": "permit",
    },
    "zone_occupied": {
        "headline": "Zone occupied",
        "detail": lambda a: f"Worker location reporting shows personnel inside the hazard boundary at {a}.",
        "category": "worker_location",
        "payload": lambda: {"zone": "hazardous"},
        "reg_hint": "confined",
    },
    "ppe_noncompliance": {
        "headline": "PPE non-compliance",
        "detail": lambda a: f"PPE check on {a} flags missing required protective equipment for the active work type.",
        "category": "ppe_status",
        "payload": lambda: {"compliant": False, "missing": random.choice(["gas_mask", "helmet", "gloves"])},
        "reg_hint": "protective",
    },
    "equipment_vibration_anomaly": {
        "headline": "Vibration anomaly",
        "detail": lambda a: f"Vibration reading on {a} is trending outside the normal ISO band, consistent with early bearing wear.",
        "category": "sensor",
        "payload": lambda: {"vibration_mm_s": round(random.uniform(7.5, 12.0), 2)},
        "reg_hint": "mechanical",
    },
    "tank_level_critical": {
        "headline": "Tank level critical",
        "detail": lambda a: f"Level reading on {a} is outside the safe operating band.",
        "category": "sensor",
        "payload": lambda: {"level_pct": round(random.choice([random.uniform(0, 5), random.uniform(95, 100)]), 1)},
        "reg_hint": "storage",
    },
}
_ELEVATED_TYPES = list(_STORIES.keys())
_BLOCKING_PAIRS = [
    ("elevated_gas", "incomplete_isolation"),
    ("permit_conflict", "zone_occupied"),
    ("over_temperature", "incomplete_isolation"),
    ("ppe_noncompliance", "zone_occupied"),
]

# Nominal reviews model the honest shape of a routine one: context arrived, the
# rules ran over it, and nothing fired. So these carry a context entry and NO
# derived fact — a nominal review with facts attached would be a contradiction,
# and fact count is not what makes a verdict anyway (risk/policy.py blocks on a
# pathway). Every payload sits well inside the bands in core/config.py
# (gas_elevated 20 ppm, temp_elevated 80 C, vibration_anomaly 7.1,
# tank_level 5-95%), so if the real rules were run over them none would fire.
_NOMINAL_STORIES = {
    "routine_gas_round": {
        "headline": "Routine atmosphere check",
        "detail": lambda a: f"Atmosphere check on {a} returned {random.randint(2, 11)} ppm, well inside the 20 ppm action threshold.",
        "category": "sensor",
        "payload": lambda: {"gas_reading": round(random.uniform(1.0, 11.0), 1), "unit": "ppm"},
    },
    "routine_temp_round": {
        "headline": "Temperature within band",
        "detail": lambda a: f"Temperature on {a} steady at {random.randint(38, 66)} C, inside the normal operating band.",
        "category": "sensor",
        "payload": lambda: {"temp_reading": round(random.uniform(38.0, 66.0), 1), "unit": "C"},
    },
    "permit_closed_clean": {
        "headline": "Permit closed clean",
        "detail": lambda a: f"Permit on {a} closed with all isolation steps verified and signed off.",
        "category": "permit",
        "payload": lambda: {"permit_id": f"PTW-{random.randint(1000,9999)}", "status": "closed", "isolation_verified": True},
    },
    "vibration_in_band": {
        "headline": "Vibration in band",
        "detail": lambda a: f"Vibration on {a} at {round(random.uniform(1.5, 4.0), 1)} mm/s, inside the ISO band-A envelope.",
        "category": "sensor",
        "payload": lambda: {"vibration_mm_s": round(random.uniform(1.5, 4.0), 1)},
    },
    "level_in_band": {
        "headline": "Level in band",
        "detail": lambda a: f"Level on {a} at {random.randint(35, 70)}%, comfortably between the low and high marks.",
        "category": "sensor",
        "payload": lambda: {"level_pct": round(random.uniform(35.0, 70.0), 1)},
    },
}
_NOMINAL_TYPES = list(_NOMINAL_STORIES.keys())

OUTCOME_BY_RISK = {
    "nominal": [("approved", 100)],
    "blocking": [("blocked", 100)],
    "elevated": [("approved_with_conditions", 60), ("approved", 30), ("blocked", 10)],
}


def _weighted(pairs):
    items, weights = zip(*pairs)
    return random.choices(items, weights=weights)[0]


def _poisson(rate: float) -> int:
    """Knuth's algorithm — reviews/day as a Poisson draw, not a fixed range.

    Real safety events don't arrive on a schedule: most days are quiet, a few
    have two or three. A uniform random.randint(min, max) every day produces
    a flat, obviously-synthetic cadence; Poisson gives the right shape (mean
    = rate, with quiet and busy days in realistic proportion) for a handful
    of lines of code, no numpy dependency needed.
    """
    if rate <= 0:
        return 0
    limit = math.exp(-rate)
    k, p = 0, 1.0
    while True:
        k += 1
        p *= random.random()
        if p <= limit:
            return k - 1


async def fetch_regulations(session) -> list[dict]:
    rows = (await session.execute(text("SELECT id, code, title, body_summary FROM regulations"))).mappings().all()
    return [dict(r) for r in rows]


async def ensure_supervisors(session) -> None:
    """Idempotently insert the extra supervisor users (Rajesh already exists)."""
    for sup in SUPERVISORS[1:]:
        await session.execute(
            text(
                """
                INSERT INTO users (id, name, role) VALUES (CAST(:id AS uuid), :name, :role)
                ON CONFLICT (id) DO NOTHING
                """
            ),
            sup,
        )
    await session.commit()


async def wipe_seeded_rows(session) -> None:
    """
    Remove only previously mock-seeded rows (reviews.is_seeded = TRUE, plus
    everything hanging off them) so re-running this script is idempotent
    without ever touching real data — no TRUNCATE, real rows are never in
    scope by construction. context_entries/derived_facts are matched by
    provider='quick_mock' (the only marker they carry; is_seeded lives on
    reviews only, see schema.sql).
    """
    seeded_reviews = "(SELECT id FROM reviews WHERE is_seeded)"
    seeded_assessments = f"(SELECT id FROM assessments WHERE review_id IN {seeded_reviews})"
    for stmt in (
        f"DELETE FROM notifications WHERE review_id IN {seeded_reviews}",
        f"DELETE FROM evidence WHERE review_id IN {seeded_reviews}",
        f"DELETE FROM review_tasks WHERE review_id IN {seeded_reviews}",
        f"DELETE FROM review_comments WHERE review_id IN {seeded_reviews}",
        f"DELETE FROM recommendations WHERE assessment_id IN {seeded_assessments}",
        f"DELETE FROM assessment_metadata WHERE assessment_id IN {seeded_assessments}",
        f"DELETE FROM decisions WHERE review_id IN {seeded_reviews}",
        f"DELETE FROM reports WHERE review_id IN {seeded_reviews}",
        f"DELETE FROM assessments WHERE review_id IN {seeded_reviews}",
        """DELETE FROM derived_facts WHERE source_context_ids && (
               SELECT COALESCE(array_agg(id), '{}') FROM context_entries WHERE provider = 'quick_mock'
           )""",
        "DELETE FROM context_entries WHERE provider = 'quick_mock'",
        "DELETE FROM reviews WHERE is_seeded",
    ):
        await session.execute(text(stmt))
    await session.commit()


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def seed_one_review(session, asset: dict, sim_time: datetime, regulations: list[dict]) -> None:
    supervisor = random.choice(SUPERVISORS)
    # ~30% of reviews are operator-raised (origin='operator') rather than
    # system-triggered — puts the panel operators' names in the corpus too,
    # not just the deciding supervisor's.
    operator = random.choice(OPERATOR_ACTORS) if random.random() < 0.3 else None

    risk_level = _weighted(list(RISK_WEIGHTS.items()))
    if risk_level == "blocking":
        fact_types = list(_BLOCKING_PAIRS[random.randrange(len(_BLOCKING_PAIRS))])
    elif risk_level == "elevated":
        fact_types = [random.choice(_ELEVATED_TYPES)]
    else:
        fact_types = []  # nominal: context arrived, no rule fired

    review_id = uuid.uuid4()
    context_ids = []
    fact_rows = []
    reasoning_factors = []
    cited_reg_ids = set()

    if risk_level == "nominal":
        # One benign context entry and no derived fact. Nothing is cited either:
        # nothing deviated, so there is no clause to cite — which keeps
        # cited_reg_ids empty and the frozen packet's citation list honest.
        nominal_story = _NOMINAL_STORIES[random.choice(_NOMINAL_TYPES)]
        story = nominal_story
        ctx_id = uuid.uuid4()
        context_ids.append(ctx_id)
        valid_from = sim_time - timedelta(minutes=random.randint(5, 40))
        await session.execute(
            text(
                """
                INSERT INTO context_entries (id, asset_id, category, payload, provider, valid_from, valid_until, confidence)
                VALUES (:id, :asset_id, :category, CAST(:payload AS jsonb), 'quick_mock', :valid_from, :valid_until, :confidence)
                """
            ),
            {
                "id": ctx_id,
                "asset_id": asset["id"],
                "category": story["category"],
                "payload": __import__("json").dumps(story["payload"]()),
                "valid_from": valid_from,
                "valid_until": valid_from + timedelta(hours=4),
                "confidence": round(random.uniform(0.85, 1.0), 2),
            },
        )
        reasoning_factors.append(
            {
                "fact_type": None,
                "headline": story["headline"],
                "detail": story["detail"](asset["name"]),
                "evidence": [],
                "context_ids": [str(ctx_id)],
            }
        )

    for i, ft in enumerate(fact_types):
        story = _STORIES[ft]
        ctx_id = uuid.uuid4()
        context_ids.append(ctx_id)
        valid_from = sim_time - timedelta(minutes=random.randint(5, 40))
        await session.execute(
            text(
                """
                INSERT INTO context_entries (id, asset_id, category, payload, provider, valid_from, valid_until, confidence)
                VALUES (:id, :asset_id, :category, CAST(:payload AS jsonb), 'quick_mock', :valid_from, :valid_until, :confidence)
                """
            ),
            {
                "id": ctx_id,
                "asset_id": asset["id"],
                "category": story["category"],
                "payload": __import__("json").dumps(story["payload"]()),
                "valid_from": valid_from,
                "valid_until": valid_from + timedelta(hours=4),
                "confidence": round(random.uniform(0.85, 1.0), 2),
            },
        )

        fact_id = uuid.uuid4()
        await session.execute(
            text(
                """
                INSERT INTO derived_facts (id, asset_id, fact_type, value, computed_at, source_context_ids)
                VALUES (:id, :asset_id, :fact_type, 'true'::jsonb, :computed_at, ARRAY[:ctx_id]::uuid[])
                """
            ),
            {"id": fact_id, "asset_id": asset["id"], "fact_type": ft, "computed_at": sim_time, "ctx_id": ctx_id},
        )
        fact_rows.append({"id": str(fact_id), "fact_type": ft, "label": story["headline"], "value": True, "computed_at": _iso(sim_time), "source_context_ids": [str(ctx_id)]})

        matches = [r for r in regulations if story["reg_hint"] in r["title"].lower() or story["reg_hint"] in r["body_summary"].lower()]
        evidence_regs = (matches or regulations)[:2]
        for r in evidence_regs:
            cited_reg_ids.add(r["id"])
        reasoning_factors.append(
            {
                "fact_type": ft,
                "headline": story["headline"],
                "detail": story["detail"](asset["name"]),
                "evidence": [
                    {
                        "source": "regulations",
                        "id": str(r["id"]),
                        "code": r["code"],
                        "title": r["title"],
                        "snippet": r["body_summary"][:180],
                        "triggered_by_fact": ft,
                    }
                    for r in evidence_regs
                ],
                "context_ids": [str(ctx_id)],
            }
        )

    # reviews.triggered_by is a single label, and a nominal review has no fact to
    # name. Fall back to the context category that opened it ("sensor", "permit"),
    # which is what actually triggered the round.
    trigger_label = fact_types[0] if fact_types else nominal_story["category"]

    outcome = _weighted(OUTCOME_BY_RISK[risk_level])
    # _NOMINAL_STORIES entries carry the same headline/detail/category shape as
    # _STORIES, so downstream titling works for both without a branch.
    headline_story = _STORIES[fact_types[0]] if fact_types else nominal_story
    if fact_types:
        summary = f"{asset['name']} is {risk_level} due to {headline_story['headline'].lower()}."
        if len(fact_types) > 1:
            summary += f" Compounded by {_STORIES[fact_types[1]]['headline'].lower()}."
    else:
        # Nominal: say what was checked, not what was wrong. "due to <fact>"
        # has no meaning when no rule fired.
        summary = (
            f"{asset['name']} is nominal — {reasoning_factors[0]['headline'].lower()}, "
            "no derived facts and no hazard pathway."
        )

    created_at = sim_time
    # Decision latency is long-tailed, not a flat band: most calls are quick, a
    # minority drag while someone walks the floor or waits on a gas test, and
    # night-shift decisions skew slower (thinner staffing). Computed here rather
    # than at the decision INSERT below because `closed_at` must land after it —
    # a review cannot close before the decision that closed it.
    _latency = random.choice([random.uniform(4, 18), random.uniform(18, 45), random.uniform(45, 150)])
    if created_at.hour >= 22 or created_at.hour < 6:
        _latency *= random.uniform(1.2, 1.8)
    submitted_at = created_at + timedelta(minutes=_latency)
    closed_at = submitted_at + timedelta(minutes=random.uniform(3, 40))

    origin = "operator" if operator else "system"
    await session.execute(
        text(
            """
            INSERT INTO reviews (id, asset_id, state, owner_id, triggered_by, origin, raised_by_worker_id, created_at, closed_at, is_seeded)
            VALUES (:id, :asset_id, 'closed', :owner_id, :triggered_by, :origin, :raised_by, :created_at, :closed_at, TRUE)
            """
        ),
        {
            "id": review_id,
            "asset_id": asset["id"],
            "owner_id": supervisor["id"],
            "triggered_by": trigger_label,
            "origin": origin,
            "raised_by": operator["id"] if operator else None,
            "created_at": created_at,
            "closed_at": closed_at,
        },
    )

    assessment_id = uuid.uuid4()
    assessment_created = created_at + timedelta(minutes=2)
    await session.execute(
        text(
            """
            INSERT INTO assessments (id, review_id, assessment_type, status, risk_level, summary, derived_fact_ids, version, created_at)
            VALUES (:id, :review_id, 'ai', 'complete', :risk_level, :summary, CAST(:fact_ids AS uuid[]), 1, :created_at)
            """
        ),
        {"id": assessment_id, "review_id": review_id, "risk_level": risk_level, "summary": summary, "fact_ids": [str(f["id"]) for f in fact_rows], "created_at": assessment_created},
    )

    citations = [
        # cited_in_summary=False, not True. The real builder derives this by
        # extracting citation tokens from the prose and intersecting them with the
        # supported set (reports/packet.py:959-962). This seeder's summary is the
        # template "{asset} is {risk} due to {headline}." — it contains no citation
        # token at all, so claiming the clause was cited in the summary put a badge
        # on every reference for something that never happened.
        {"source": "regulations", "id": str(r["id"]), "code": r["code"], "title": r["title"], "snippet": r["body_summary"][:180], "cited_in_summary": False}
        for r in regulations if r["id"] in cited_reg_ids
    ]
    await session.execute(
        text(
            """
            INSERT INTO assessment_metadata (assessment_id, provider, model, prompt_version, confidence,
                retrieved_references, retrieval_mode, retrieval_quality, reasoning_factors)
            -- retrieval_quality is NULL, not 'strong'. The deterministic path is
            -- taken *because* the quality gate failed, so 'deterministic' + 'strong'
            -- is a pair the real pipeline never emits (a live run at gate 0.59 gave
            -- deterministic + weak). NULL says "not measured", which is the truth
            -- here, and keeps 329 mock rows out of the retrieval-quality figure on
            -- AI Ops.
            VALUES (:aid, 'mock', 'deterministic', 'quick-mock-v1', :confidence,
                CAST(:refs AS jsonb), 'deterministic', NULL, CAST(:factors AS jsonb))
            """
        ),
        {
            "aid": assessment_id,
            "confidence": round(random.uniform(0.7, 0.95), 2),
            "refs": __import__("json").dumps(citations),
            "factors": __import__("json").dumps(reasoning_factors),
        },
    )

    rec_id = uuid.uuid4()
    rec_text = random.choice(_REC_BY_RISK[risk_level])
    await session.execute(
        text("INSERT INTO recommendations (id, assessment_id, text, rationale, disposition) VALUES (:id, :aid, :text, :rationale, 'accepted')"),
        {"id": rec_id, "aid": assessment_id, "text": rec_text, "rationale": reasoning_factors[0]["detail"]},
    )

    decision_id = uuid.uuid4()
    conditions = random.choice(_CONDITIONS_POOL) if outcome != "approved" else None
    comments = random.choice(_COMMENT_POOL)
    await session.execute(
        text(
            """
            INSERT INTO decisions (id, review_id, assessment_id, decided_by, outcome, conditions, comments, submitted_at)
            VALUES (:id, :review_id, :aid, :decided_by, :outcome, :conditions, :comments, :submitted_at)
            """
        ),
        {"id": decision_id, "review_id": review_id, "aid": assessment_id, "decided_by": supervisor["id"], "outcome": outcome, "conditions": conditions, "comments": comments, "submitted_at": submitted_at},
    )

    outcome_labels = {"approved": "Approved", "approved_with_conditions": "Approved with conditions", "blocked": "Blocked"}
    packet = {
        "meta": {
            "packet_version": PACKET_VERSION,
            "review_id": str(review_id),
            "closure_event_seq": 1,
            "version_label": "v1",
            "report_ref": f"RPT-{str(review_id)[:8].upper()}",
            "frozen_at": _iso(closed_at),
            "closed_by": supervisor["name"],
            "built_from": "quick_mock",
        },
        "header": {
            "title": f"{asset['name']} — {headline_story['headline']}",
            "asset": {"id": asset["id"], "name": asset["name"], "zone": asset["zone"], "plant_id": "plant-1", "floor": asset["floor"]},
            "review_state": "closed",
            "origin": origin,
            "triggered_by": trigger_label,
            "opened_at": _iso(created_at),
            "closed_at": _iso(closed_at),
            "duration_seconds": (closed_at - created_at).total_seconds(),
            "owner": {"id": supervisor["id"], "name": supervisor["name"], "role": supervisor["role"]},
            "raised_by": {"id": operator["id"], "name": operator["name"], "role": operator["role"]} if operator else None,
            "outcome_headline": outcome_labels[outcome],
            "risk_headline": risk_level.capitalize(),
        },
        "decision": {
            "id": str(decision_id),
            "outcome": outcome,
            "outcome_label": outcome_labels[outcome],
            "conditions": conditions,
            "comments": comments,
            "decided_by": {"id": supervisor["id"], "name": supervisor["name"]},
            "submitted_at": _iso(submitted_at),
            "assessment_id": str(assessment_id),
            "time_to_decision_seconds": (submitted_at - created_at).total_seconds(),
            "dispositions": [{"recommendation_id": str(rec_id), "text": rec_text, "rationale": reasoning_factors[0]["detail"], "disposition": "accepted"}],
        },
        "assessment": {
            "source": "frozen",
            "id": str(assessment_id),
            "version": 1,
            "assessment_type": "ai",
            "status": "complete",
            "risk_level": risk_level,
            "summary": summary,
            "created_at": _iso(assessment_created),
            "provider": "mock",
            "model": "deterministic",
            # retrieval_mode is accurate: no vector search happened here. But
            # "deterministic" + "strong" is a pair the real pipeline never
            # produces — the deterministic path is taken *because* the quality
            # gate failed, so a real deterministic row reads "weak" (verified
            # against a live run at gate 0.59). Leaving quality null says "not
            # measured", which is the truth, and keeps this row out of the
            # retrieval-quality average on AI Ops.
            "retrieval_mode": "deterministic",
            "retrieval_quality": None,
        },
        "reasoning_factors": reasoning_factors,
        "recommendations": [{"recommendation_id": str(rec_id), "text": rec_text, "rationale": reasoning_factors[0]["detail"], "disposition": "accepted"}],
        "facts": fact_rows,
        "evidence": {
            "source": "frozen",
            "captured_at": _iso(closed_at),
            "entries": [
                {
                    "id": str(cid),
                    "category": _STORIES[ft]["category"],
                    "category_label": _STORIES[ft]["category"].replace("_", " ").title(),
                    "summary_line": _STORIES[ft]["detail"](asset["name"]),
                    "provider": "quick_mock",
                    "valid_from": _iso(created_at),
                    "confidence": 0.95,
                    "payload": _STORIES[ft]["payload"](),
                }
                for cid, ft in zip(context_ids, fact_types)
            ],
        },
        "citations": {"source": "frozen", "references": citations, "cited": [c["id"] for c in citations], "unsupported": [], "ok": True},
        "tasks": {"source": "live", "total": 0, "open": 0, "acknowledged": 0, "done": 0, "cancelled": 0, "items": []},
        "discussion": [],
        "audit_trail": [],
        "timeline": [
            {"ts": _iso(created_at), "label": "Review opened", "detail": trigger_label},
            {"ts": _iso(assessment_created), "label": "Assessment completed", "detail": risk_level},
            {"ts": _iso(submitted_at), "label": "Decision submitted", "detail": outcome},
            {"ts": _iso(closed_at), "label": "Review closed"},
        ],
    }

    content_hash = packet_hash(packet)
    await session.execute(
        text(
            """
            INSERT INTO reports (review_id, closure_event_seq, content, content_hash, packet_version,
                supersedes_report_id, closed_by, frozen_at, evidence_id, snapshot_hash)
            VALUES (:review_id, 1, CAST(:content AS jsonb), :content_hash, :packet_version,
                NULL, :closed_by, :frozen_at, NULL, NULL)
            """
        ),
        {
            "review_id": review_id,
            "content": __import__("json").dumps(packet, default=str),
            "content_hash": content_hash,
            "packet_version": PACKET_VERSION,
            "closed_by": supervisor["name"],
            "frozen_at": closed_at,
        },
    )

    if outcome == "blocked":
        # Status is age-weighted, not always 'open'. A task from a year ago
        # that's still open reads as a plant that never follows up on its own
        # stop-work orders — and it permanently clogs every future shift
        # handover, since compose_carry_forward treats 'open'/'acknowledged'
        # as still-outstanding regardless of how old they are. Older tasks
        # are increasingly likely to have actually been closed out.
        age_days = (datetime.now(timezone.utc) - submitted_at).total_seconds() / 86400
        if age_days > 60:
            status = _weighted([("done", 90), ("acknowledged", 8), ("open", 2)])
        elif age_days > 14:
            status = _weighted([("done", 70), ("acknowledged", 20), ("open", 10)])
        else:
            status = _weighted([("done", 30), ("acknowledged", 30), ("open", 40)])

        acknowledged_at = None
        done_at = None
        done_note = None
        if status in ("acknowledged", "done"):
            acknowledged_at = submitted_at + timedelta(hours=random.uniform(0.5, 18))
        if status == "done":
            done_at = acknowledged_at + timedelta(hours=random.uniform(0.5, 36))
            done_note = random.choice([
                "Isolation re-verified; gas test clear. Permit reinstated.",
                "Corrective work completed and signed off by area authority.",
                "Fault cleared; equipment returned to service.",
                None,
            ])

        assignee = random.choice(WORKERS)[0]  # (id, name, certs) — any of the 5 field workers
        await session.execute(
            text(
                """
                INSERT INTO review_tasks (id, review_id, decision_id, assigned_worker_id, task_type,
                    title, detail, status, created_by, created_at, acknowledged_at, done_at, done_note)
                VALUES (:id, :review_id, :decision_id, :assigned_worker_id, 'unblock',
                    :title, :detail, :status, :created_by, :created_at, :acknowledged_at, :done_at, :done_note)
                """
            ),
            {
                "id": uuid.uuid4(),
                "review_id": review_id,
                "decision_id": decision_id,
                "assigned_worker_id": assignee,
                "title": f"Unblock {asset['name']}",
                "detail": rec_text,
                "status": status,
                "created_by": supervisor["name"],
                "created_at": submitted_at,
                "acknowledged_at": acknowledged_at,
                "done_at": done_at,
                "done_note": done_note,
            },
        )


async def main() -> None:
    import time as _time

    daily_rate = ARGS.reviews_per_week / 7.0
    print(f"Seeding quick mock data against: {_settings.database_url}")
    if ARGS.total is not None:
        print(f"days={ARGS.days} total={ARGS.total} (exact, weighted across the window) seed={ARGS.seed}")
    else:
        print(f"days={ARGS.days} target={ARGS.reviews_per_week}/week (~{daily_rate:.2f}/day, Poisson) seed={ARGS.seed}")
    print(f"Supervisors: {', '.join(s['name'] for s in SUPERVISORS)}")
    print(f"Operators (raise ~30% of reviews): {', '.join(o['name'] for o in OPERATOR_ACTORS)}")

    async with SessionLocal() as session:
        print("Clearing previously mock-seeded rows only (real data untouched)...")
        await wipe_seeded_rows(session)
        await ensure_supervisors(session)
        regulations = await fetch_regulations(session)
        print(f"Loaded {len(regulations)} regulations for citations.")

    window_end = datetime.now(timezone.utc)
    # Normalised to midnight. Without this, each "day start" carries the current
    # wall-clock time (e.g. 21:47), so _pick_timestamp's shift offset pushed most
    # events onto the following calendar date — which silently destroyed the
    # weekday/weekend weighting below (Monday's events landed on Tuesday).
    _midnight = window_end.replace(hour=0, minute=0, second=0, microsecond=0)
    day_starts = [_midnight - timedelta(days=ARGS.days - d) for d in range(ARGS.days)]

    if ARGS.total is not None:
        # Exact-count mode: place each review on a day chosen by that day's
        # realistic weight (weekday/weekend + season), so the total lands
        # precisely while the *shape* still varies the way a real log does.
        weights = [_day_weight(d) for d in day_starts]
        chosen_days = random.choices(day_starts, weights=weights, k=ARGS.total)
        plan = sorted(chosen_days)
    else:
        plan = []
        for day_start in day_starts:
            for _ in range(_poisson(daily_rate * _day_weight(day_start))):
                plan.append(day_start)

    total_reviews = 0
    t0 = _time.monotonic()
    async with SessionLocal() as session:
        for i, day_start in enumerate(plan):
            asset = ASSET_BY_ID[random.choices(ASSET_IDS, weights=_ASSET_WEIGHTS)[0]]
            sim_time = _pick_timestamp(day_start)
            await seed_one_review(session, asset, sim_time, regulations)
            total_reviews += 1
            if (i + 1) % 50 == 0 or i == len(plan) - 1:
                elapsed = _time.monotonic() - t0
                print(f"  {i + 1}/{len(plan)} | {elapsed:6.1f}s elapsed")
        await session.commit()

    elapsed = _time.monotonic() - t0
    weeks = ARGS.days / 7.0
    print(f"\nDone in {elapsed:.1f}s. {total_reviews} reviews created, closed, decided, and reported.")
    print(f"Measured rate: {total_reviews / weeks:.2f}/week over {weeks:.1f} weeks (target was {ARGS.reviews_per_week}/week).")

    async with SessionLocal() as session:
        counts = (
            await session.execute(
                text(
                    """
                    SELECT 'reviews (seeded)', count(*) FROM reviews WHERE is_seeded
                    UNION ALL SELECT 'reviews (real, untouched)', count(*) FROM reviews WHERE NOT is_seeded
                    UNION ALL SELECT 'decisions (seeded)', count(*) FROM decisions d
                        JOIN reviews r2 ON r2.id = d.review_id WHERE r2.is_seeded
                    UNION ALL SELECT 'assessments (seeded)', count(*) FROM assessments a
                        JOIN reviews r2 ON r2.id = a.review_id WHERE r2.is_seeded
                    UNION ALL SELECT 'reports (seeded)', count(*) FROM reports rp
                        JOIN reviews r2 ON r2.id = rp.review_id WHERE r2.is_seeded
                    UNION ALL SELECT 'review_tasks (seeded)', count(*) FROM review_tasks t
                        JOIN reviews r2 ON r2.id = t.review_id WHERE r2.is_seeded
                    """
                )
            )
        ).all()
        by_supervisor = (
            await session.execute(
                text(
                    """
                    SELECT u.name, count(*) FROM decisions d
                    JOIN reviews r ON r.id = d.review_id JOIN users u ON u.id = d.decided_by
                    WHERE r.is_seeded GROUP BY u.name ORDER BY count(*) DESC
                    """
                )
            )
        ).all()
        by_operator = (
            await session.execute(
                text(
                    """
                    SELECT w.name, count(*) FROM reviews r
                    JOIN workers w ON w.id = r.raised_by_worker_id
                    WHERE r.is_seeded AND r.origin = 'operator' GROUP BY w.name ORDER BY count(*) DESC
                    """
                )
            )
        ).all()
    for row in counts:
        print(f"  {row[0]:24s} {row[1]}")
    print("\nDecisions by supervisor:")
    for name, cnt in by_supervisor:
        print(f"  {name:32s} {cnt}")
    print("Reviews raised by operator (rest are system-triggered):")
    for name, cnt in by_operator:
        print(f"  {name:32s} {cnt}")

    print("\nTo view: open http://localhost:3000/operator, toggle \"Seeded mode\" on in the Demo panel")
    print("(top nav), and the mock reviews/reports above appear alongside whatever real data exists —")
    print("toggle off and they're hidden again. No .env or restart needed; it's a live in-app switch.")


if __name__ == "__main__":
    asyncio.run(main())
