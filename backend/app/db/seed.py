"""Idempotent seed data for Phase 2/7 — fixed UUIDs aligned with frontend fixtures."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal

logger = logging.getLogger(__name__)

DEPT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

# Panel operators hold the twin and hand custody to each other at shift change.
# The supervisor (OWNER_ID) decides; nobody hands a decision-maker a shift, so
# the handover parties are these two rather than the supervisor.
# (id, name, role)
OPERATORS = [
    ("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Meera (Panel Operator · A)", "panel_operator"),
    ("cccccccc-cccc-cccc-cccc-cccccccccccc", "Arun (Panel Operator · B)", "panel_operator"),
]

# (id, name, zone, floor, sensor_kinds)
#
# `sensor_kinds` is the instrumentation the asset actually carries, drawn only
# from the kinds the derived-fact rules in context/derived_facts.py consume
# (gas · temp · vibration · level · ph). An empty list is a real answer, not a
# gap: a muster point or an office has no process instrumentation, and the
# ambient feed emits no SCADA sample for it. Scripted scenarios post explicit
# payloads and are unaffected by this list.
ASSETS = [
    # Ground floor — existing plant process areas
    ("11111111-1111-1111-1111-111111111111", "Vessel A", "coke-oven-battery", "ground", ["gas", "temp"]),
    ("22222222-2222-2222-2222-222222222222", "Walkway 3", "hazardous", "ground", ["gas"]),
    ("33333333-3333-3333-3333-333333333333", "Compressor B", "compressor-yard", "ground", ["vibration", "temp"]),
    ("44444444-4444-4444-4444-444444444444", "Tank Farm C", "tank-farm", "ground", ["level", "gas"]),
    ("66666666-6666-6666-6666-666666666661", "By-Product Plant", "byproduct-plant", "ground", ["gas", "temp"]),
    ("66666666-6666-6666-6666-666666666662", "Coke Battery B", "coke-oven-battery", "ground", ["gas", "temp"]),
    ("66666666-6666-6666-6666-666666666663", "DRI Plant", "dri-plant", "ground", ["temp", "gas"]),
    ("66666666-6666-6666-6666-666666666664", "ETP", "etp", "ground", ["ph", "level"]),
    ("66666666-6666-6666-6666-666666666665", "Control Room", "control-room", "ground", ["temp"]),
    ("66666666-6666-6666-6666-666666666666", "Raw Material Yard", "raw-material-yard", "ground", ["vibration"]),
    # First floor — process & utility mezzanine
    ("77777777-7777-7777-7777-777777777701", "Gas Cleaning Plant", "gas-cleaning", "first", ["gas", "temp"]),
    ("77777777-7777-7777-7777-777777777702", "Pump House", "pump-house", "first", ["vibration", "temp"]),
    ("77777777-7777-7777-7777-777777777703", "Boiler House", "boiler-house", "first", ["temp", "level", "gas"]),
    ("77777777-7777-7777-7777-777777777704", "Electrical Substation", "substation", "first", ["temp"]),
    ("77777777-7777-7777-7777-777777777705", "Instrument Air Plant", "instrument-air", "first", ["vibration", "temp"]),
    ("77777777-7777-7777-7777-777777777706", "Maintenance Workshop", "workshop", "first", ["temp"]),
    ("77777777-7777-7777-7777-777777777707", "Pipe Rack Gantry", "pipe-rack", "first", ["gas"]),
    ("77777777-7777-7777-7777-777777777708", "Weighbridge & Loading Dock", "weighbridge", "first", ["gas"]),
    ("77777777-7777-7777-7777-777777777709", "Fire Water Pump Station", "fire-water", "first", ["level", "vibration"]),
    # Second floor — elevated ops & control
    ("77777777-7777-7777-7777-777777777801", "Central Control Room", "central-control", "second", ["temp"]),
    ("77777777-7777-7777-7777-777777777802", "SCADA Room", "scada", "second", ["temp"]),
    ("77777777-7777-7777-7777-777777777803", "Admin & Shift Office", "admin-office", "second", []),
    ("77777777-7777-7777-7777-777777777804", "Crane / Hoist Deck", "crane-deck", "second", ["vibration"]),
    ("77777777-7777-7777-7777-777777777805", "Elevated Conveyor Gantry", "conveyor-gantry", "second", ["vibration", "temp"]),
    ("77777777-7777-7777-7777-777777777806", "Rooftop Cooling Towers", "cooling-towers", "second", ["temp", "level", "vibration"]),
    ("77777777-7777-7777-7777-777777777807", "Muster Point", "muster-point", "second", []),
    ("77777777-7777-7777-7777-777777777808", "HVAC Plant", "hvac", "second", ["temp", "vibration"]),
]

WORKERS = [
    (
        "55555555-5555-5555-5555-555555555551",
        "Asha Rao",
        [
            {
                "name": "hot_work",
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=90)).isoformat(),
            }
        ],
    ),
    (
        "55555555-5555-5555-5555-555555555552",
        "Imran Khan",
        [
            {
                "name": "confined_space",
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            }
        ],
    ),
    (
        "55555555-5555-5555-5555-555555555553",
        "Priya Nair",
        [
            {
                "name": "gas_testing",
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
            }
        ],
    ),
    (
        "55555555-5555-5555-5555-555555555554",
        "Dev Patel",
        [
            {
                "name": "hot_work",
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=120)).isoformat(),
            }
        ],
    ),
    (
        "55555555-5555-5555-5555-555555555555",
        "Meera Joshi",
        [
            {
                "name": "lockout_tagout",
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=60)).isoformat(),
            }
        ],
    ),
]

# zone → (worker_id, role) — one named area owner per unique zone label
ZONE_OWNERS = [
    ("coke-oven-battery", "55555555-5555-5555-5555-555555555551", "Area Supervisor"),
    ("hazardous", "55555555-5555-5555-5555-555555555552", "Area Supervisor"),
    ("compressor-yard", "55555555-5555-5555-5555-555555555553", "Area Supervisor"),
    ("tank-farm", "55555555-5555-5555-5555-555555555554", "Area Supervisor"),
    ("byproduct-plant", "55555555-5555-5555-5555-555555555555", "Area Supervisor"),
    ("dri-plant", "55555555-5555-5555-5555-555555555551", "Area Supervisor"),
    ("etp", "55555555-5555-5555-5555-555555555553", "Area Supervisor"),
    ("control-room", "55555555-5555-5555-5555-555555555552", "Shift Lead"),
    ("raw-material-yard", "55555555-5555-5555-5555-555555555554", "Area Supervisor"),
    ("gas-cleaning", "55555555-5555-5555-5555-555555555551", "Area Supervisor"),
    ("pump-house", "55555555-5555-5555-5555-555555555553", "Area Supervisor"),
    ("boiler-house", "55555555-5555-5555-5555-555555555555", "Area Supervisor"),
    ("substation", "55555555-5555-5555-5555-555555555554", "Area Supervisor"),
    ("instrument-air", "55555555-5555-5555-5555-555555555553", "Area Supervisor"),
    ("workshop", "55555555-5555-5555-5555-555555555555", "Area Supervisor"),
    ("pipe-rack", "55555555-5555-5555-5555-555555555552", "Area Supervisor"),
    ("weighbridge", "55555555-5555-5555-5555-555555555554", "Area Supervisor"),
    ("fire-water", "55555555-5555-5555-5555-555555555551", "Area Supervisor"),
    ("central-control", "55555555-5555-5555-5555-555555555552", "Shift Lead"),
    ("scada", "55555555-5555-5555-5555-555555555552", "Shift Lead"),
    ("admin-office", "55555555-5555-5555-5555-555555555555", "Shift Lead"),
    ("crane-deck", "55555555-5555-5555-5555-555555555551", "Area Supervisor"),
    ("conveyor-gantry", "55555555-5555-5555-5555-555555555554", "Area Supervisor"),
    ("cooling-towers", "55555555-5555-5555-5555-555555555553", "Area Supervisor"),
    ("muster-point", "55555555-5555-5555-5555-555555555552", "Area Supervisor"),
    ("hvac", "55555555-5555-5555-5555-555555555553", "Area Supervisor"),
]


# One deliberately unhealthy channel, so the `degraded` coverage state is
# reachable in the product rather than only in unit tests. Without it every
# scenario and every ambient sample reports confidence ≥ 0.95 with no fault
# payload, `rule_sensor_unreliable` never fires, and a judge can only reach
# `degraded` by hand-crafting a POST /context.
#
# Rooftop Cooling Towers is chosen because it carries no scenario and is not a
# demo focus asset, so a permanently suspect reading there cannot perturb the
# scripted runs. The entry is labelled synthetic in its own payload and in its
# provider string, both of which render in the asset's context feed.
DEGRADED_SENSOR_ASSET_ID = "77777777-7777-7777-7777-777777777806"
DEGRADED_SENSOR_PROVIDER = "seed:demo-degraded-sensor"


async def _seed_degraded_sensor(session: AsyncSession) -> None:
    """
    Re-seed the one synthetic degraded channel, idempotently.

    Deleted-then-inserted rather than upserted so the validity window slides
    forward on every boot — a fixed window would silently expire and take the
    `degraded` state back out of the demo.

    This writes `context_entries` directly instead of going through
    `ingest_context`, which is deliberate: ingest would compute derived facts
    and open a review for a sensor we are describing as untrustworthy. Coverage
    reads the row on the way out (`context/coverage.py`), and
    `rule_sensor_unreliable` is not registered, so nothing here can reach
    `classify()` or move a verdict.
    """
    now = datetime.now(timezone.utc)
    await session.execute(
        text("DELETE FROM context_entries WHERE provider = :provider"),
        {"provider": DEGRADED_SENSOR_PROVIDER},
    )
    await session.execute(
        text(
            """
            INSERT INTO context_entries (
                asset_id, category, payload, provider,
                valid_from, valid_until, confidence
            )
            VALUES (
                CAST(:asset_id AS uuid), 'sensor', CAST(:payload AS jsonb),
                :provider, :valid_from, :valid_until, :confidence
            )
            """
        ),
        {
            "asset_id": DEGRADED_SENSOR_ASSET_ID,
            "payload": json.dumps(
                {
                    "temp_reading": 31.4,
                    "unit": "C",
                    "status": "fault",
                    "fault_code": "TT-4412 drift / last calibration overdue",
                    "synthetic": True,
                    "synthetic_note": (
                        "Seeded demo channel — one deliberately unhealthy "
                        "sensor so the degraded coverage state is observable."
                    ),
                }
            ),
            "provider": DEGRADED_SENSOR_PROVIDER,
            "valid_from": now - timedelta(minutes=1),
            "valid_until": now + timedelta(days=365),
            "confidence": 0.30,
        },
    )


async def seed_minimal(session: AsyncSession | None = None) -> None:
    owns_session = session is None
    if session is None:
        session = SessionLocal()

    try:
        await session.execute(
            text(
                """
                INSERT INTO departments (id, name)
                VALUES (CAST(:id AS uuid), :name)
                ON CONFLICT (id) DO NOTHING
                """
            ),
            {"id": DEPT_ID, "name": "Coke Oven Ops"},
        )

        for asset_id, name, zone, floor, sensor_kinds in ASSETS:
            await session.execute(
                text(
                    """
                    INSERT INTO assets (id, name, zone, plant_id, floor, sensor_kinds)
                    VALUES (
                        CAST(:id AS uuid), :name, :zone, 'plant-1', :floor,
                        CAST(:sensor_kinds AS jsonb)
                    )
                    ON CONFLICT (id) DO UPDATE
                      SET name = EXCLUDED.name,
                          zone = EXCLUDED.zone,
                          floor = EXCLUDED.floor,
                          sensor_kinds = EXCLUDED.sensor_kinds
                    """
                ),
                {
                    "id": asset_id,
                    "name": name,
                    "zone": zone,
                    "floor": floor,
                    "sensor_kinds": json.dumps(sensor_kinds),
                },
            )

        await session.execute(
            text(
                """
                INSERT INTO users (id, name, role)
                VALUES (CAST(:id AS uuid), :name, :role)
                ON CONFLICT (id) DO UPDATE
                  SET name = EXCLUDED.name, role = EXCLUDED.role
                """
            ),
            {
                "id": OWNER_ID,
                "name": "Rajesh (Shift Supervisor)",
                "role": "decision_maker",
            },
        )

        for operator_id, operator_name, operator_role in OPERATORS:
            await session.execute(
                text(
                    """
                    INSERT INTO users (id, name, role)
                    VALUES (CAST(:id AS uuid), :name, :role)
                    ON CONFLICT (id) DO UPDATE
                      SET name = EXCLUDED.name, role = EXCLUDED.role
                    """
                ),
                {"id": operator_id, "name": operator_name, "role": operator_role},
            )

        for worker_id, name, certs in WORKERS:
            await session.execute(
                text(
                    """
                    INSERT INTO workers (id, name, certifications, department_id)
                    VALUES (
                        CAST(:id AS uuid),
                        :name,
                        CAST(:certs AS jsonb),
                        CAST(:dept AS uuid)
                    )
                    ON CONFLICT (id) DO UPDATE
                      SET name = EXCLUDED.name,
                          certifications = EXCLUDED.certifications,
                          department_id = EXCLUDED.department_id
                    """
                ),
                {
                    "id": worker_id,
                    "name": name,
                    "certs": json.dumps(certs),
                    "dept": DEPT_ID,
                },
            )

        for zone, worker_id, role in ZONE_OWNERS:
            await session.execute(
                text(
                    """
                    INSERT INTO zone_owners (zone, worker_id, role)
                    VALUES (:zone, CAST(:worker_id AS uuid), :role)
                    ON CONFLICT (zone) DO UPDATE
                      SET worker_id = EXCLUDED.worker_id,
                          role = EXCLUDED.role
                    """
                ),
                {"zone": zone, "worker_id": worker_id, "role": role},
            )

        await _seed_degraded_sensor(session)

        await session.commit()
        logger.info(
            "seed_minimal: departments, assets, users, workers, zone_owners upserted"
        )
    finally:
        if owns_session:
            await session.close()
