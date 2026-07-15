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

# (id, name, zone, floor)
ASSETS = [
    # Ground floor — existing plant process areas
    ("11111111-1111-1111-1111-111111111111", "Vessel A", "coke-oven-battery", "ground"),
    ("22222222-2222-2222-2222-222222222222", "Walkway 3", "hazardous", "ground"),
    ("33333333-3333-3333-3333-333333333333", "Compressor B", "compressor-yard", "ground"),
    ("44444444-4444-4444-4444-444444444444", "Tank Farm C", "tank-farm", "ground"),
    ("66666666-6666-6666-6666-666666666661", "By-Product Plant", "byproduct-plant", "ground"),
    ("66666666-6666-6666-6666-666666666662", "Coke Battery B", "coke-oven-battery", "ground"),
    ("66666666-6666-6666-6666-666666666663", "DRI Plant", "dri-plant", "ground"),
    ("66666666-6666-6666-6666-666666666664", "ETP", "etp", "ground"),
    ("66666666-6666-6666-6666-666666666665", "Control Room", "control-room", "ground"),
    ("66666666-6666-6666-6666-666666666666", "Raw Material Yard", "raw-material-yard", "ground"),
    # First floor — process & utility mezzanine
    ("77777777-7777-7777-7777-777777777701", "Gas Cleaning Plant", "gas-cleaning", "first"),
    ("77777777-7777-7777-7777-777777777702", "Pump House", "pump-house", "first"),
    ("77777777-7777-7777-7777-777777777703", "Boiler House", "boiler-house", "first"),
    ("77777777-7777-7777-7777-777777777704", "Electrical Substation", "substation", "first"),
    ("77777777-7777-7777-7777-777777777705", "Instrument Air Plant", "instrument-air", "first"),
    ("77777777-7777-7777-7777-777777777706", "Maintenance Workshop", "workshop", "first"),
    ("77777777-7777-7777-7777-777777777707", "Pipe Rack Gantry", "pipe-rack", "first"),
    ("77777777-7777-7777-7777-777777777708", "Weighbridge & Loading Dock", "weighbridge", "first"),
    ("77777777-7777-7777-7777-777777777709", "Fire Water Pump Station", "fire-water", "first"),
    # Second floor — elevated ops & control
    ("77777777-7777-7777-7777-777777777801", "Central Control Room", "central-control", "second"),
    ("77777777-7777-7777-7777-777777777802", "SCADA Room", "scada", "second"),
    ("77777777-7777-7777-7777-777777777803", "Admin & Shift Office", "admin-office", "second"),
    ("77777777-7777-7777-7777-777777777804", "Crane / Hoist Deck", "crane-deck", "second"),
    ("77777777-7777-7777-7777-777777777805", "Elevated Conveyor Gantry", "conveyor-gantry", "second"),
    ("77777777-7777-7777-7777-777777777806", "Rooftop Cooling Towers", "cooling-towers", "second"),
    ("77777777-7777-7777-7777-777777777807", "Muster Point", "muster-point", "second"),
    ("77777777-7777-7777-7777-777777777808", "HVAC Plant", "hvac", "second"),
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

        for asset_id, name, zone, floor in ASSETS:
            await session.execute(
                text(
                    """
                    INSERT INTO assets (id, name, zone, plant_id, floor)
                    VALUES (
                        CAST(:id AS uuid), :name, :zone, 'plant-1', :floor
                    )
                    ON CONFLICT (id) DO UPDATE
                      SET name = EXCLUDED.name,
                          zone = EXCLUDED.zone,
                          floor = EXCLUDED.floor
                    """
                ),
                {"id": asset_id, "name": name, "zone": zone, "floor": floor},
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

        await session.commit()
        logger.info(
            "seed_minimal: departments, assets, users, workers, zone_owners upserted"
        )
    finally:
        if owns_session:
            await session.close()
