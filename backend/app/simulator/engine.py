"""DemoController — start / reset / status for YAML scenario replay and Random Mode."""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Any, Literal

from app.assessment.orchestrator import orchestrator
from app.context.schemas import ContextIn
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.simulator.dsl import (
    ScenarioFile,
    ScenarioNotFoundError,
    load_scenario,
    resolve_asset_id,
)
from app.simulator.provider import SimulatorProvider
from app.simulator.random_engine import (
    RandomModeConfig,
    count_open_reviews,
    default_config_from_settings,
    emit_issue,
    list_assets_with_open_reviews,
    load_assets,
    pick_signals,
)
from sqlalchemy import text

logger = logging.getLogger(__name__)

# FK-safe wipe order for runtime (demo) tables. Master/seed data is left intact.
_RESET_DELETE_ORDER = (
    "evidence",
    "decisions",
    "recommendations",
    "assessment_metadata",
    "assessments",
    "reports",
    "notifications",
    "reviews",
    "derived_facts",
    "context_entries",
    "audit_entries",
)

DemoMode = Literal["idle", "scripted", "random"]


class ScenarioAlreadyRunningError(RuntimeError):
    """Raised when start() is called while a scenario is already in flight."""


class DemoController:
    """
    Singleton-ish coordinator for Demo Mode scenario replay and Random Mode.
    Mirrors AssessmentOrchestrator's in-process asyncio task pattern.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._scenario_name: str | None = None
        self._step_index: int = 0
        self._total_steps: int = 0
        self._started_at: datetime | None = None
        self._running: bool = False
        self._mode: DemoMode = "idle"
        self._random_config: RandomModeConfig | None = None
        self._issues_spawned: int = 0
        self._active_issue_count: int = 0

    def status(self) -> dict[str, Any]:
        return {
            "mode": self._mode,
            "scenario": self._scenario_name,
            "step_index": self._step_index,
            "total_steps": self._total_steps,
            "running": self._running,
            "started_at": (
                self._started_at.isoformat() if self._started_at else None
            ),
            "issues_spawned": self._issues_spawned,
            "active_issue_count": self._active_issue_count,
            "config": (
                self._random_config.model_dump() if self._random_config else None
            ),
        }

    def _assert_idle(self) -> None:
        if self._running and self._task is not None and not self._task.done():
            raise ScenarioAlreadyRunningError(
                f"Demo mode {self._mode!r} "
                f"({self._scenario_name or 'random'}) is already running; "
                "POST /demo/reset or wait for it to finish"
            )

    async def start(self, name: str) -> dict[str, Any]:
        self._assert_idle()

        scenario = load_scenario(name)  # raises ScenarioNotFoundError

        self._mode = "scripted"
        self._scenario_name = scenario.name
        self._step_index = 0
        self._total_steps = len(scenario.steps)
        self._started_at = datetime.now(timezone.utc)
        self._running = True
        self._random_config = None
        self._issues_spawned = 0
        self._active_issue_count = 0
        self._task = asyncio.create_task(
            self._run(scenario), name=f"demo-{scenario.name}"
        )
        return self.status()

    async def start_random(
        self, config: RandomModeConfig | None = None
    ) -> dict[str, Any]:
        self._assert_idle()
        cfg = config or default_config_from_settings()
        self._mode = "random"
        self._scenario_name = "random"
        self._step_index = 0
        self._total_steps = cfg.issue_cap or 0
        self._started_at = datetime.now(timezone.utc)
        self._running = True
        self._random_config = cfg
        self._issues_spawned = 0
        self._active_issue_count = 0
        self._task = asyncio.create_task(
            self._run_random(cfg), name="demo-random"
        )
        return self.status()

    async def _run(self, scenario: ScenarioFile) -> None:
        settings = get_settings()
        try:
            for i, step in enumerate(scenario.steps):
                delay = (
                    step.delay_seconds
                    if step.delay_seconds is not None
                    else float(settings.simulator_default_step_delay_seconds)
                )
                if delay > 0:
                    await asyncio.sleep(delay)

                self._step_index = i
                now = datetime.now(timezone.utc)
                from datetime import timedelta

                valid_until = now + timedelta(hours=step.valid_for_hours)

                async with SessionLocal() as session:
                    asset_id = await resolve_asset_id(session, step.asset)
                    body = ContextIn(
                        asset_id=asset_id,
                        category=step.category,
                        payload=step.payload,
                        provider="simulator",
                        valid_from=now,
                        valid_until=valid_until,
                        confidence=step.confidence,
                    )
                    provider = SimulatorProvider(session)
                    result = await provider.emit(body)
                    logger.info(
                        "demo step %d/%d (%s) → review=%s facts=%s",
                        i + 1,
                        self._total_steps,
                        step.category,
                        result.review.id if result.review else None,
                        [f.fact_type for f in result.derived_facts],
                    )
                self._step_index = i + 1
        except asyncio.CancelledError:
            logger.info("demo scenario %s cancelled", scenario.name)
            raise
        except Exception:  # noqa: BLE001 — stop the run rather than crash silently
            logger.exception(
                "demo scenario %s failed at step %d",
                scenario.name,
                self._step_index,
            )
        finally:
            self._running = False
            if self._mode == "scripted":
                self._mode = "idle"

    async def _run_random(self, config: RandomModeConfig) -> None:
        rng = random.Random(config.seed)
        try:
            while True:
                if (
                    config.issue_cap is not None
                    and self._issues_spawned >= config.issue_cap
                ):
                    logger.info(
                        "random mode reached issue_cap=%d", config.issue_cap
                    )
                    break

                delay = rng.uniform(
                    config.spawn_interval_min_seconds,
                    config.spawn_interval_max_seconds,
                )
                await asyncio.sleep(delay)

                async with SessionLocal() as session:
                    open_count = await count_open_reviews(session)
                    self._active_issue_count = open_count
                    if open_count >= config.max_concurrent_issues:
                        logger.debug(
                            "random mode at concurrency cap (%d); skipping spawn",
                            open_count,
                        )
                        continue

                    assets = await load_assets(session, config.floors)
                    if not assets:
                        logger.warning("random mode: no assets in pool")
                        break

                    busy = set(await list_assets_with_open_reviews(session))
                    compound = (
                        busy
                        and rng.random() < config.compound_probability
                    )
                    if compound:
                        pool = [a for a in assets if a.id in busy]
                    else:
                        pool = [a for a in assets if a.id not in busy] or assets

                    asset = rng.choice(pool)
                    signals = pick_signals(rng, config)
                    facts = await emit_issue(
                        session,
                        asset=asset,
                        signals=signals,
                        rng=rng,
                        valid_for_hours=config.valid_for_hours,
                    )
                    self._issues_spawned += 1
                    self._step_index = self._issues_spawned
                    self._active_issue_count = await count_open_reviews(session)
                    logger.info(
                        "random issue #%d on %s (%s) signals=%s facts=%s",
                        self._issues_spawned,
                        asset.name,
                        asset.floor,
                        signals,
                        facts,
                    )
        except asyncio.CancelledError:
            logger.info("random mode cancelled")
            raise
        except Exception:  # noqa: BLE001
            logger.exception("random mode failed after %d issues", self._issues_spawned)
        finally:
            self._running = False
            if self._mode == "random":
                self._mode = "idle"

    async def reset(self) -> dict[str, str]:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = None
        self._scenario_name = None
        self._step_index = 0
        self._total_steps = 0
        self._started_at = None
        self._running = False
        self._mode = "idle"
        self._random_config = None
        self._issues_spawned = 0
        self._active_issue_count = 0

        # Drain + pause the assessment worker so an in-flight job cannot re-insert
        # rows between DELETE statements (FK violation race).
        orchestrator.drain()
        worker = orchestrator._worker_task
        orchestrator.stop()
        if worker is not None:
            try:
                await asyncio.wait_for(asyncio.shield(worker), timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

        async with SessionLocal() as session:
            for table in _RESET_DELETE_ORDER:
                await session.execute(text(f"DELETE FROM {table}"))
            await session.commit()

        orchestrator.start()
        logger.info("demo reset complete — runtime tables wiped")
        return {"status": "reset"}


demo_controller = DemoController()
