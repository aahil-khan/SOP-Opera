"""Random Mode — combinatorial issue spawn alongside scripted YAML scenarios."""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

if TYPE_CHECKING:
    from app.simulator.sources import OrchestratorSim

logger = logging.getLogger(__name__)

PlantFloor = Literal["ground", "first", "second"]

SIGNAL_CATALOG: dict[str, dict[str, Any]] = {
    "elevated_gas": {
        "weight": 1.2,
        "builders": lambda rng: [
            {
                "category": "sensor",
                "payload": {
                    "gas_reading": round(rng.uniform(22.0, 45.0), 1),
                    "unit": "ppm",
                },
            }
        ],
    },
    "permit_conflict": {
        "weight": 1.0,
        "builders": lambda rng: [
            {
                "category": "permit",
                "payload": {
                    "permit_id": f"rp-{uuid4().hex[:8]}",
                    "status": "active",
                    "work_type": "hot_work",
                },
            },
            {
                "category": "permit",
                "payload": {
                    "permit_id": f"rp-{uuid4().hex[:8]}",
                    "status": "active",
                    "work_type": "cold_work",
                },
            },
        ],
    },
    "zone_occupied": {
        "weight": 1.0,
        "builders": lambda rng: [
            {
                "category": "worker_location",
                "payload": {
                    "worker_id": "55555555-5555-5555-5555-555555555551",
                    "zone": "hazardous",
                },
            }
        ],
    },
    "incomplete_isolation": {
        "weight": 0.8,
        "builders": lambda rng: [
            {
                "category": "permit",
                "payload": {
                    "permit_id": f"iso-{uuid4().hex[:8]}",
                    "status": "active",
                    "work_type": "hot_work",
                },
            }
        ],
    },
    "simultaneous_ops": {
        "weight": 0.8,
        "builders": lambda rng: [
            {
                "category": "permit",
                "payload": {
                    "permit_id": f"sim-{uuid4().hex[:8]}",
                    "status": "active",
                    "work_type": "hot_work",
                },
            },
            {
                "category": "permit",
                "payload": {
                    "permit_id": f"sim-{uuid4().hex[:8]}",
                    "status": "active",
                    "work_type": "confined_space",
                },
            },
        ],
    },
    "certification_expiring": {
        "weight": 0.7,
        "builders": lambda rng: [
            {
                "category": "worker_location",
                "payload": {
                    "worker_id": "55555555-5555-5555-5555-555555555553",
                    "zone": "hazardous",
                },
            },
            {
                "category": "certification",
                "payload": {
                    "worker_id": "55555555-5555-5555-5555-555555555553",
                    "name": "gas_testing",
                    "expires_at": (
                        datetime.now(timezone.utc) + timedelta(days=2)
                    ).isoformat(),
                },
            },
        ],
    },
    "over_temperature": {
        "weight": 1.0,
        "builders": lambda rng: [
            {
                "category": "sensor",
                "payload": {
                    "temp_reading": round(rng.uniform(85.0, 140.0), 1),
                    "unit": "C",
                },
            }
        ],
    },
    "equipment_vibration_anomaly": {
        "weight": 0.9,
        "builders": lambda rng: [
            {
                "category": "sensor",
                "payload": {
                    "vibration_mm_s": round(rng.uniform(7.5, 14.0), 2),
                },
            }
        ],
    },
    "effluent_quality_breach": {
        "weight": 0.7,
        "builders": lambda rng: [
            {
                "category": "sensor",
                "payload": {
                    "ph": round(
                        rng.choice([rng.uniform(3.5, 5.5), rng.uniform(9.5, 11.5)]),
                        2,
                    ),
                },
            }
        ],
    },
    "tank_level_critical": {
        "weight": 0.8,
        "builders": lambda rng: [
            {
                "category": "sensor",
                "payload": {
                    "level_pct": round(
                        rng.choice([rng.uniform(1.0, 4.0), rng.uniform(96.0, 99.5)]),
                        1,
                    ),
                },
            }
        ],
    },
    "ppe_noncompliance": {
        "weight": 0.9,
        "builders": lambda rng: [
            {
                "category": "ppe_status",
                "payload": {
                    "worker_id": "55555555-5555-5555-5555-555555555554",
                    "compliant": False,
                    "missing": rng.choice(["helmet", "gas_mask", "gloves"]),
                },
            }
        ],
    },
    "lifting_operation_conflict": {
        "weight": 0.7,
        "builders": lambda rng: [
            {
                "category": "lift_plan",
                "payload": {
                    "lift_id": f"lift-{uuid4().hex[:6]}",
                    "status": "active",
                },
            },
            {
                "category": "lift_plan",
                "payload": {
                    "lift_id": f"lift-{uuid4().hex[:6]}",
                    "status": "active",
                },
            },
        ],
    },
    "weather_hold": {
        "weight": 0.6,
        "builders": lambda rng: [
            {
                "category": "weather",
                "payload": {
                    "wind_ms": round(rng.uniform(16.0, 28.0), 1),
                    "lightning": rng.random() < 0.35,
                },
            },
            {
                "category": "permit",
                "payload": {
                    "permit_id": f"wx-{uuid4().hex[:8]}",
                    "status": "active",
                    "work_type": "hot_work",
                },
            },
        ],
    },
}


class RandomModeConfig(BaseModel):
    max_concurrent_issues: int = Field(default=8, ge=1, le=40)
    spawn_interval_min_seconds: float = Field(default=4.0, ge=0.5)
    spawn_interval_max_seconds: float = Field(default=12.0, ge=0.5)
    compound_probability: float = Field(default=0.25, ge=0.0, le=1.0)
    seed: int | None = None
    floors: list[PlantFloor] | None = None
    signal_weights: dict[str, float] | None = None
    issue_cap: int | None = Field(default=None, ge=1)
    valid_for_hours: float = Field(default=2.0, gt=0)

    def model_post_init(self, __context: Any) -> None:
        if self.spawn_interval_max_seconds < self.spawn_interval_min_seconds:
            raise ValueError(
                "spawn_interval_max_seconds must be >= spawn_interval_min_seconds"
            )


@dataclass
class AssetRow:
    id: str
    name: str
    zone: str
    floor: str


async def load_assets(
    session: AsyncSession, floors: list[PlantFloor] | None
) -> list[AssetRow]:
    if floors:
        result = await session.execute(
            text(
                """
                SELECT id, name, zone, floor FROM assets
                WHERE floor = ANY(CAST(:floors AS text[]))
                ORDER BY name
                """
            ),
            {"floors": floors},
        )
    else:
        result = await session.execute(
            text("SELECT id, name, zone, floor FROM assets ORDER BY name")
        )
    return [
        AssetRow(
            id=str(row._mapping["id"]),
            name=row._mapping["name"],
            zone=row._mapping["zone"],
            floor=row._mapping["floor"] or "ground",
        )
        for row in result.fetchall()
    ]


async def count_open_reviews(session: AsyncSession) -> int:
    result = await session.execute(
        text(
            """
            SELECT COUNT(*) AS n FROM reviews
            WHERE state NOT IN ('closed')
            """
        )
    )
    row = result.first()
    return int(row._mapping["n"] if row else 0)


async def list_assets_with_open_reviews(session: AsyncSession) -> list[str]:
    result = await session.execute(
        text(
            """
            SELECT DISTINCT asset_id::text AS asset_id FROM reviews
            WHERE state NOT IN ('closed')
            """
        )
    )
    return [row._mapping["asset_id"] for row in result.fetchall()]


def pick_signals(rng: random.Random, config: RandomModeConfig) -> list[str]:
    weights = {
        name: (
            config.signal_weights.get(name, meta["weight"])
            if config.signal_weights
            else meta["weight"]
        )
        for name, meta in SIGNAL_CATALOG.items()
    }
    names = list(weights.keys())
    w = [max(0.01, float(weights[n])) for n in names]
    count = rng.choices([1, 2, 3], weights=[0.55, 0.35, 0.10], k=1)[0]
    # Weighted sample without replacement
    chosen: list[str] = []
    pool = list(zip(names, w))
    for _ in range(min(count, len(pool))):
        ns, ws = zip(*pool)
        pick = rng.choices(list(ns), weights=list(ws), k=1)[0]
        chosen.append(pick)
        pool = [(n, wt) for n, wt in pool if n != pick]
    return chosen


def build_steps_for_signals(
    rng: random.Random, signals: list[str]
) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    for signal in signals:
        builders = SIGNAL_CATALOG[signal]["builders"]
        steps.extend(builders(rng))
    return steps


async def emit_issue(
    session: AsyncSession,
    *,
    asset: AssetRow,
    signals: list[str],
    rng: random.Random,
    valid_for_hours: float,
    orch: OrchestratorSim | None = None,
) -> list[str]:
    """Inject context rows for one combinatorial issue via OrchestratorSim."""
    from app.simulator.sources import OrchestratorSim as OrchCls

    coordinator = orch or OrchCls()
    fired: list[str] = []
    steps = build_steps_for_signals(rng, signals)
    for i, step in enumerate(steps):
        result = await coordinator.emit_direct(
            session,
            asset_name=asset.name,
            category=step["category"],
            payload=step["payload"],
            confidence=1.0,
            valid_for_hours=valid_for_hours,
            step_index=i,
            total_steps=len(steps),
        )
        fired.extend(f.fact_type for f in result.ingest.derived_facts)
    return fired


def default_config_from_settings() -> RandomModeConfig:
    s = get_settings()
    return RandomModeConfig(
        max_concurrent_issues=s.random_max_concurrent_issues,
        spawn_interval_min_seconds=s.random_spawn_interval_min_seconds,
        spawn_interval_max_seconds=s.random_spawn_interval_max_seconds,
        compound_probability=s.random_compound_probability,
    )
