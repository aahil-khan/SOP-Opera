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
from app.context.schemas import ContextIn  # noqa: E402
from app.context.service import ingest_context  # noqa: E402
from app.db.seed import ASSETS  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.decisions.schemas import DecisionIn  # noqa: E402
from app.decisions.service import submit_decision  # noqa: E402
from app.reviews.repository import transition_review  # noqa: E402
from app.reviews.state_machine import ReviewEvent  # noqa: E402

random.seed(ARGS.seed)

ASSET_IDS = [a[0] for a in ASSETS]


# --- Plausible-signal generator -------------------------------------------
# Wide/log-spread on purpose (see DISTRIBUTION NOTE above). Weighted so most
# readings read as unremarkable and a minority carry a real excursion.

def _sensor_reading() -> tuple[str, dict]:
    kind = random.choices(
        ["gas", "temp", "vibration", "ph", "level"],
        weights=[35, 30, 15, 10, 10],
    )[0]
    # Severity is deliberately mild-skewed: on a real plant the large majority of
    # "off-normal" readings are minor drifts an operator glances at and moves on
    # from, not emergencies. The first spike run made every excursion severe and
    # produced a corpus with zero low-severity reviews, which read as implausible.
    excursion = random.random() < 0.16  # reading drifts off its usual band
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


def _permit_reading() -> tuple[str, dict]:
    work_type = random.choices(["cold_work", "hot_work", "confined_space"], weights=[55, 30, 15])[0]
    status = random.choices(["active", "pending", "closed"], weights=[70, 15, 15])[0]
    return "permit", {"permit_id": f"PTW-{random.randint(1000, 9999)}", "status": status, "work_type": work_type}


def _worker_location_reading() -> tuple[str, dict]:
    zone = random.choices(["safe", "hazardous"], weights=[80, 20])[0]
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


def _ppe_reading() -> tuple[str, dict]:
    compliant = random.random() < 0.88
    payload = {"worker_id": "55555555-5555-5555-5555-555555555551", "compliant": compliant}
    if not compliant:
        payload["missing"] = random.choice(["helmet", "gas_mask", "gloves"])
    return "ppe_status", payload


def _weather_reading() -> tuple[str, dict]:
    wind = random.uniform(1, 12) if random.random() > 0.1 else random.uniform(12, 22)
    return "weather", {"wind_ms": round(wind, 1), "lightning": random.random() < 0.03}


_GENERATORS = [
    (_sensor_reading, 55),
    (_permit_reading, 15),
    (_worker_location_reading, 15),
    (_ppe_reading, 10),
    (_weather_reading, 5),
]


def random_context_payload() -> tuple[str, dict]:
    gens, weights = zip(*_GENERATORS)
    return random.choices(gens, weights=weights)[0]()


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


async def _wait_for_terminal_assessment(review_id, timeout_s: float) -> dict | None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        async with SessionLocal() as session:
            rows = await list_assessments(session, review_id)
        if rows and rows[0]["status"] in ("complete", "failed"):
            return rows[0]
        await asyncio.sleep(0.2)
    return None


async def seed_one_review(asset_id: str, tally: Tally, sim_time: datetime) -> None:
    category, payload = random_context_payload()

    async with SessionLocal() as session:
        result = await ingest_context(
            session,
            ContextIn(asset_id=asset_id, category=category, payload=payload, provider="seed:history"),
        )

    if result.review is None:
        # No new/re-triggered review (facts didn't warrant one) — a normal,
        # expected outcome for most shifts. Nothing to progress.
        return

    review_id = result.review.id
    if result.review.state != "assessing":
        # Re-triggered an already-open review rather than creating a new one;
        # let a later pass close it once it settles, avoid double-handling here.
        return
    if review_id in tally.sim_times:
        # Same review handed back again (re-trigger, not a new one) — already counted.
        return

    tally.sim_times[review_id] = sim_time
    tally.reviews_created += 1

    assessment = await _wait_for_terminal_assessment(review_id, ARGS.assessment_timeout)
    if assessment is None:
        tally.assessment_timeout += 1
        return
    if assessment["status"] == "failed":
        tally.assessment_failed += 1
        return

    risk_level = assessment.get("risk_level")
    tally.by_risk_level[risk_level] = tally.by_risk_level.get(risk_level, 0) + 1

    outcome = pick_outcome(risk_level)
    dispositions = {r["id"]: "accepted" for r in assessment.get("recommendations", [])}

    async with SessionLocal() as session:
        await submit_decision(
            session,
            review_id,
            DecisionIn(outcome=outcome, recommendation_dispositions=dispositions, conditions="Seeded decision" if outcome != "approved" else None),
            actor=ARGS.actor,
        )

    async with SessionLocal() as session:
        await transition_review(session, review_id, ReviewEvent.CLOSE, ARGS.actor)

    tally.reviews_closed += 1
    tally.by_outcome[outcome] = tally.by_outcome.get(outcome, 0) + 1


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
                """UPDATE reports SET generated_at = CAST(:t AS timestamptz) + interval '25 minutes',
                          frozen_at = CAST(:t AS timestamptz) + interval '25 minutes'
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

    # Simulated clock: the corpus is presented as the `--days` window ending today.
    window_end = datetime.now(timezone.utc)
    shift_hours = 24 / ARGS.shifts_per_day

    try:
        for shift_num in range(total_shifts):
            shifts_ago = total_shifts - shift_num
            sim_time = window_end - timedelta(hours=shifts_ago * shift_hours)
            n_assets = random.randint(ARGS.assets_min, ARGS.assets_max)
            touched = random.sample(ASSET_IDS, k=min(n_assets, len(ASSET_IDS)))
            for asset_id in touched:
                # Jitter within the shift so rows don't all share one timestamp.
                jittered = sim_time + timedelta(minutes=random.randint(0, int(shift_hours * 60) - 1))
                await seed_one_review(asset_id, tally, jittered)
            if (shift_num + 1) % 10 == 0 or shift_num == total_shifts - 1:
                elapsed = time.monotonic() - t0
                print(
                    f"  shift {shift_num + 1}/{total_shifts} | {elapsed:6.1f}s elapsed | "
                    f"reviews created={tally.reviews_created} closed={tally.reviews_closed} "
                    f"failed={tally.assessment_failed} timeout={tally.assessment_timeout}"
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
    print(f"Reviews closed:         {tally.reviews_closed}")
    print(f"Assessment failed:      {tally.assessment_failed}")
    print(f"Assessment timed out:   {tally.assessment_timeout}")
    print(f"By risk_level:          {tally.by_risk_level}")
    print(f"By outcome:             {tally.by_outcome}")

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
