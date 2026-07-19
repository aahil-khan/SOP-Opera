"""Always-on ambient plant telemetry — soft WS samples + rare hard failures.

Performance notes:
- Soft samples are batched into one `telemetry.batch` WS frame per tick.
- Each asset gets a single multi-metric SCADA payload (not N separate events).
- Status chips emit sparsely; hard heartbeat is rare and quiet (no orch spam).
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.realtime.connection_manager import manager
from app.simulator.dsl import ScenarioStep
from app.simulator.sources import CATEGORY_TO_SOURCE, OrchestratorSim, SOURCE_LABELS

logger = logging.getLogger(__name__)

# Coincidence signals that open real reviews (subset of random catalog)
COINCIDENCE_SIGNALS: list[dict[str, Any]] = [
    {
        "category": "sensor",
        "payload": lambda rng: {
            "gas_reading": round(rng.uniform(22.0, 40.0), 1),
            "unit": "ppm",
        },
    },
    {
        "category": "sensor",
        "payload": lambda rng: {
            "temp_reading": round(rng.uniform(85.0, 120.0), 1),
            "unit": "C",
        },
    },
    {
        "category": "sensor",
        "payload": lambda rng: {
            "vibration_mm_s": round(rng.uniform(7.5, 12.0), 2),
        },
    },
    {
        "category": "worker_location",
        "payload": lambda rng: {
            "worker_id": "55555555-5555-5555-5555-555555555551",
            "zone": "hazardous",
        },
    },
    {
        "category": "permit",
        "payload": lambda rng: {
            "permit_id": f"amb-{uuid4().hex[:8]}",
            "status": "active",
            "work_type": "hot_work",
        },
    },
]


def nominal_sensor_payload(rng: random.Random, settings: Any) -> dict[str, Any]:
    """Single-metric SCADA sample (used by coincidence / heartbeat / tests)."""
    gas_ceiling = max(1.0, float(settings.gas_elevated_threshold) - 2.0)
    temp_ceiling = max(20.0, float(settings.temp_elevated_threshold) - 5.0)
    vib_ceiling = max(0.5, float(settings.vibration_anomaly_threshold) - 0.5)
    level_lo = float(settings.tank_level_low_pct) + 5.0
    level_hi = float(settings.tank_level_high_pct) - 5.0
    ph_lo = float(settings.effluent_ph_min) + 0.3
    ph_hi = float(settings.effluent_ph_max) - 0.3
    wind_ceiling = max(1.0, float(settings.weather_wind_hold_ms) - 2.0)

    kind = rng.choice(
        ["gas", "temp", "vibration", "level", "ph", "wind"]
    )
    if kind == "gas":
        return {
            "gas_reading": round(rng.uniform(0.5, gas_ceiling), 1),
            "unit": "ppm",
        }
    if kind == "temp":
        return {
            "temp_reading": round(rng.uniform(25.0, temp_ceiling), 1),
            "unit": "C",
        }
    if kind == "vibration":
        return {
            "vibration_mm_s": round(rng.uniform(0.2, vib_ceiling), 2),
        }
    if kind == "level":
        return {
            "level_pct": round(rng.uniform(level_lo, level_hi), 1),
        }
    if kind == "ph":
        return {"ph": round(rng.uniform(ph_lo, ph_hi), 2)}
    return {
        "wind_ms": round(rng.uniform(0.5, wind_ceiling), 1),
        "lightning": False,
    }


def nominal_scada_bundle(rng: random.Random, settings: Any) -> dict[str, Any]:
    """Multi-metric payload — one WS sample updates several gauges."""
    gas_ceiling = max(1.0, float(settings.gas_elevated_threshold) - 2.0)
    temp_ceiling = max(20.0, float(settings.temp_elevated_threshold) - 5.0)
    vib_ceiling = max(0.5, float(settings.vibration_anomaly_threshold) - 0.5)
    level_lo = float(settings.tank_level_low_pct) + 5.0
    level_hi = float(settings.tank_level_high_pct) - 5.0
    # Small jitter so sparklines move without looking chaotic
    return {
        "gas_reading": round(rng.uniform(0.5, gas_ceiling), 1),
        "temp_reading": round(rng.uniform(28.0, temp_ceiling), 1),
        "vibration_mm_s": round(rng.uniform(0.3, vib_ceiling), 2),
        "level_pct": round(rng.uniform(level_lo, level_hi), 1),
        "unit": "ppm",
    }


def nominal_status_sample(rng: random.Random) -> tuple[str, dict[str, Any]] | None:
    """At most one sparse non-SCADA soft status."""
    roll = rng.random()
    if roll < 0.34:
        return (
            "permit",
            {
                "permit_id": f"idle-{rng.randint(1, 9)}",
                "status": "idle",
                "work_type": rng.choice(["cold_work", "inspection"]),
            },
        )
    if roll < 0.55:
        return ("isolation_status", {"complete": True, "verified": True})
    if roll < 0.75:
        return (
            "worker_location",
            {
                "worker_id": "55555555-5555-5555-5555-555555555552",
                "zone": "safe",
            },
        )
    return None


def assert_nominal_below_thresholds(payload: dict[str, Any], settings: Any) -> None:
    """Raise AssertionError if a soft sample would trip a rule threshold."""
    if "gas_reading" in payload:
        assert float(payload["gas_reading"]) <= float(settings.gas_elevated_threshold)
    if "temp_reading" in payload:
        assert float(payload["temp_reading"]) <= float(settings.temp_elevated_threshold)
    if "vibration_mm_s" in payload:
        assert float(payload["vibration_mm_s"]) <= float(
            settings.vibration_anomaly_threshold
        )
    if "level_pct" in payload:
        lvl = float(payload["level_pct"])
        assert float(settings.tank_level_low_pct) < lvl < float(
            settings.tank_level_high_pct
        )
    if "ph" in payload:
        ph = float(payload["ph"])
        assert float(settings.effluent_ph_min) <= ph <= float(settings.effluent_ph_max)
    if "wind_ms" in payload:
        assert float(payload["wind_ms"]) < float(settings.weather_wind_hold_ms)


async def _load_assets(session: AsyncSession) -> list[dict[str, str]]:
    result = await session.execute(
        text("SELECT id::text AS id, name, floor FROM assets ORDER BY name")
    )
    return [
        {
            "id": row._mapping["id"],
            "name": row._mapping["name"],
            "floor": row._mapping["floor"] or "ground",
        }
        for row in result.fetchall()
    ]


def _sample_dict(
    *,
    source: str,
    asset_id: str,
    asset_name: str,
    category: str,
    payload: dict[str, Any],
    mode: str = "ambient",
    ts: str | None = None,
) -> dict[str, Any]:
    return {
        "source": source,
        "label": SOURCE_LABELS.get(source, source),
        "asset_id": asset_id,
        "asset_name": asset_name,
        "category": category,
        "payload": payload,
        "ts": ts or datetime.now(timezone.utc).isoformat(),
        "mode": mode,
    }


async def broadcast_telemetry_sample(
    *,
    source: str,
    asset_id: str,
    asset_name: str,
    category: str,
    payload: dict[str, Any],
    mode: str = "ambient",
) -> None:
    await manager.broadcast(
        "telemetry.sample",
        _sample_dict(
            source=source,
            asset_id=asset_id,
            asset_name=asset_name,
            category=category,
            payload=payload,
            mode=mode,
        ),
    )


async def broadcast_telemetry_batch(samples: list[dict[str, Any]]) -> None:
    if not samples:
        return
    await manager.broadcast(
        "telemetry.batch",
        {"samples": samples, "count": len(samples)},
    )


class AmbientPlantLoop:
    """
    Always-on plant feed.
    Soft telemetry every tick; rare coincidence + periodic heartbeat hard-ingest
    only for assets not demo-locked.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._running = False
        self._cursor = 0
        self._last_heartbeat: datetime | None = None
        self._orch = OrchestratorSim()
        self._rng = random.Random()
        self._assets_cache: list[dict[str, str]] = []

    @property
    def running(self) -> bool:
        return self._running and self._task is not None and not self._task.done()

    def status(self) -> dict[str, Any]:
        from app.simulator.engine import demo_controller

        settings = get_settings()
        return {
            "running": self.running,
            "enabled_default": settings.ambient_enabled,
            "tick_seconds": settings.ambient_tick_seconds,
            "coincidence_probability": settings.ambient_coincidence_probability,
            "heartbeat_seconds": settings.ambient_heartbeat_seconds,
            "batch_size": settings.ambient_batch_size,
            "demo_locked_assets": sorted(demo_controller.locked_asset_ids),
        }

    def start(self) -> asyncio.Task | None:
        if self.running:
            return self._task
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="ambient-plant")
        logger.info("ambient plant loop started")
        return self._task

    async def stop(self) -> None:
        self._running = False
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None
        logger.info("ambient plant loop stopped")

    async def _refresh_assets(self) -> None:
        try:
            async with SessionLocal() as session:
                self._assets_cache = await _load_assets(session)
        except Exception:  # noqa: BLE001
            logger.debug("ambient: asset refresh failed", exc_info=True)

    def _next_batch(self, n: int) -> list[dict[str, str]]:
        if not self._assets_cache:
            return []
        batch: list[dict[str, str]] = []
        total = len(self._assets_cache)
        for _ in range(min(n, total)):
            batch.append(self._assets_cache[self._cursor % total])
            self._cursor = (self._cursor + 1) % total
        return batch

    async def _soft_tick(self, locked: set[str], *, tick: int, settings: Any) -> None:
        batch = self._next_batch(settings.ambient_batch_size)
        ts = datetime.now(timezone.utc).isoformat()
        samples: list[dict[str, Any]] = []
        emit_status = tick % max(1, int(settings.ambient_status_every_n_ticks)) == 0

        for asset in batch:
            if asset["id"] in locked:
                continue
            payload = nominal_scada_bundle(self._rng, settings)
            samples.append(
                _sample_dict(
                    source="scada",
                    asset_id=asset["id"],
                    asset_name=asset["name"],
                    category="sensor",
                    payload=payload,
                    ts=ts,
                )
            )
            if emit_status:
                status = nominal_status_sample(self._rng)
                if status is not None:
                    cat, status_payload = status
                    samples.append(
                        _sample_dict(
                            source=CATEGORY_TO_SOURCE.get(cat, "scada"),
                            asset_id=asset["id"],
                            asset_name=asset["name"],
                            category=cat,
                            payload=status_payload,
                            ts=ts,
                        )
                    )

        await broadcast_telemetry_batch(samples)

    async def _coincidence(self, locked: set[str], settings: Any) -> None:
        if self._rng.random() >= settings.ambient_coincidence_probability:
            return
        unlocked = [a for a in self._assets_cache if a["id"] not in locked]
        if not unlocked:
            return
        asset = self._rng.choice(unlocked)
        signal = self._rng.choice(COINCIDENCE_SIGNALS)
        payload = signal["payload"](self._rng)
        category = signal["category"]
        step = ScenarioStep(
            asset=asset["name"],
            category=category,
            payload=payload,
            confidence=0.95,
            delay_seconds=0,
            valid_for_hours=2.0,
        )
        try:
            async with SessionLocal() as session:
                await self._orch.run_step(
                    session,
                    step,
                    step_index=0,
                    total_steps=1,
                )
                from app.simulator.engine import demo_controller

                demo_controller.lock_asset(asset["id"])
            logger.info(
                "ambient coincidence on %s category=%s",
                asset["name"],
                category,
            )
        except Exception:  # noqa: BLE001
            logger.exception("ambient coincidence failed")

    async def _heartbeat(self, locked: set[str], settings: Any) -> None:
        """Rare quiet hard-ingest — refreshes context without Orchestrator WS spam."""
        now = datetime.now(timezone.utc)
        if self._last_heartbeat is not None:
            elapsed = (now - self._last_heartbeat).total_seconds()
            if elapsed < settings.ambient_heartbeat_seconds:
                return
        self._last_heartbeat = now
        unlocked = [a for a in self._assets_cache if a["id"] not in locked]
        if not unlocked:
            return
        asset = unlocked[self._cursor % len(unlocked)]
        payload = nominal_sensor_payload(self._rng, settings)
        category = "weather" if "wind_ms" in payload else "sensor"
        source = CATEGORY_TO_SOURCE.get(category, "scada")
        try:
            from app.context.schemas import ContextIn
            from app.simulator.provider import SimulatorProvider

            async with SessionLocal() as session:
                body = ContextIn(
                    asset_id=UUID(asset["id"]),
                    category=category,
                    payload=payload,
                    provider=f"simulator:{source}",
                    valid_from=now,
                    valid_until=now + timedelta(hours=1.0),
                    confidence=1.0,
                )
                await SimulatorProvider(session).emit(body)
            await broadcast_telemetry_sample(
                source=source,
                asset_id=asset["id"],
                asset_name=asset["name"],
                category=category,
                payload=payload,
            )
        except Exception:  # noqa: BLE001
            logger.debug("ambient heartbeat ingest failed", exc_info=True)

    async def _loop(self) -> None:
        settings = get_settings()
        await self._refresh_assets()
        ticks = 0
        try:
            while self._running:
                from app.simulator.engine import demo_controller

                # Re-read settings infrequently so env tweaks apply without restart spam
                if ticks % 10 == 0:
                    settings = get_settings()

                locked = set(demo_controller.locked_asset_ids)
                if ticks % 40 == 0:
                    await self._refresh_assets()
                await self._soft_tick(locked, tick=ticks, settings=settings)
                await self._coincidence(locked, settings)
                await self._heartbeat(locked, settings)
                ticks += 1
                await asyncio.sleep(settings.ambient_tick_seconds)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("ambient loop crashed")
        finally:
            self._running = False


ambient_loop = AmbientPlantLoop()
