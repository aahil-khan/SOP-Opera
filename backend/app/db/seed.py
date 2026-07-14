"""Idempotent seed data for Phase 2 — fixed UUIDs aligned with frontend fixtures."""

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

ASSETS = [
    ("11111111-1111-1111-1111-111111111111", "Vessel A", "coke-oven-battery"),
    ("22222222-2222-2222-2222-222222222222", "Walkway 3", "hazardous"),
    ("33333333-3333-3333-3333-333333333333", "Compressor B", "compressor-yard"),
    ("44444444-4444-4444-4444-444444444444", "Tank Farm C", "tank-farm"),
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

        for asset_id, name, zone in ASSETS:
            await session.execute(
                text(
                    """
                    INSERT INTO assets (id, name, zone, plant_id)
                    VALUES (CAST(:id AS uuid), :name, :zone, 'plant-1')
                    ON CONFLICT (id) DO UPDATE
                      SET name = EXCLUDED.name, zone = EXCLUDED.zone
                    """
                ),
                {"id": asset_id, "name": name, "zone": zone},
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

        await session.commit()
        logger.info("seed_minimal: departments, assets, users, workers upserted")
    finally:
        if owns_session:
            await session.close()
