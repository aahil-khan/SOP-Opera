"""DemoController — start / reset / status for YAML scenario replay and Random Mode."""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from app.assessment.orchestrator import orchestrator
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.simulator.dsl import (
    ScenarioFile,
    ScenarioNotFoundError,
    load_scenario,
    resolve_asset_id,
)
from app.simulator.random_engine import (
    RandomModeConfig,
    count_open_reviews,
    default_config_from_settings,
    emit_issue,
    list_assets_with_open_reviews,
    load_assets,
    pick_signals,
)
from app.simulator.sources import OrchestratorSim, list_sources
from sqlalchemy import text

logger = logging.getLogger(__name__)

# FK-safe wipe order for runtime (demo) tables. Master/seed data is left intact.
# ai_ops_events is intentionally excluded — append-only pipeline analytics.
_RESET_DELETE_ORDER = (
    "evidence",
    "review_tasks",
    "review_comments",
    "decisions",
    "recommendations",
    "assessment_metadata",
    "assessments",
    "reports",
    "notifications",
    "reviews",
    "derived_facts",
    "context_entries",
    "telemetry_samples",
    "audit_entries",
)

DemoMode = Literal["idle", "scripted", "random"]


class ScenarioAlreadyRunningError(RuntimeError):
    """Raised when start() is called while a scenario is already in flight."""


@dataclass
class InactiveLock:
    asset_id: str
    review_id: str


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
        self._orch_sim = OrchestratorSim()
        self._sources_used: list[str] = []
        self._locked_asset_ids: set[str] = set()
        self._inactive_locks_by_asset: dict[str, InactiveLock] = {}
        self._inactive_locks_by_review: dict[str, str] = {}

    @property
    def locked_asset_ids(self) -> set[str]:
        return set(self._locked_asset_ids)

    def lock_asset(self, asset_id: str | UUID) -> None:
        self._locked_asset_ids.add(str(asset_id))

    def unlock_asset(self, asset_id: str | UUID) -> None:
        self._locked_asset_ids.discard(str(asset_id))

    def clear_locks(self) -> None:
        self._locked_asset_ids.clear()
        self._inactive_locks_by_asset.clear()
        self._inactive_locks_by_review.clear()

    def _clear_stale_inactive_locks(self) -> None:
        # HITL unlock is explicit (task completion). We no longer apply time-based
        # cleanup for blocked decisions.
        return

    @property
    def inactive_asset_ids(self) -> set[str]:
        return set(self._inactive_locks_by_asset.keys())

    def is_asset_inactive(self, asset_id: str | UUID) -> bool:
        return str(asset_id) in self._inactive_locks_by_asset

    async def wait_until_asset_active(self, asset_id: str | UUID) -> None:
        while self.is_asset_inactive(asset_id):
            await asyncio.sleep(1.0)

    def lock_asset_inactive(
        self, *, asset_id: str | UUID, review_id: str | UUID
    ) -> None:
        aid = str(asset_id)
        rid = str(review_id)
        # Clear prior mapping for this review if it targeted a different asset.
        previous_asset = self._inactive_locks_by_review.get(rid)
        if previous_asset and previous_asset != aid:
            self._inactive_locks_by_asset.pop(previous_asset, None)
        self._inactive_locks_by_asset[aid] = InactiveLock(
            asset_id=aid,
            review_id=rid,
        )
        self._inactive_locks_by_review[rid] = aid

    def clear_inactive_lock_for_review(self, review_id: str | UUID) -> None:
        rid = str(review_id)
        aid = self._inactive_locks_by_review.pop(rid, None)
        if aid is None:
            return
        self._inactive_locks_by_asset.pop(aid, None)

    def mark_review_closed(
        self, *, review_id: str | UUID, asset_id: str | UUID | None = None
    ) -> None:
        # No-op: blocked assets unlock only after HITL task completion.
        return

    def status(self) -> dict[str, Any]:
        from app.simulator.ambient import ambient_loop

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
            "sources_used": list(self._sources_used),
            "sources": list_sources(),
            "ambient_running": ambient_loop.running,
            "demo_locked_assets": sorted(self._locked_asset_ids),
            "demo_inactive_assets": sorted(self.inactive_asset_ids),
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

    async def _wipe_runtime(self) -> None:
        """Delete demo runtime rows so scenarios can replay cleanly."""
        orchestrator.drain()
        workers = list(orchestrator._worker_tasks)
        boot = getattr(orchestrator, "_boot_task", None)
        orchestrator.stop()
        pending = [t for t in (*workers, boot) if t is not None and not t.done()]
        if pending:
            try:
                await asyncio.wait_for(
                    asyncio.shield(asyncio.gather(*pending, return_exceptions=True)),
                    timeout=2.0,
                )
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

        async with SessionLocal() as session:
            for table in _RESET_DELETE_ORDER:
                await session.execute(text(f"DELETE FROM {table}"))
            # Seeded near-misses stay; live closures promoted during the last run go.
            from app.incidents.service import wipe_promoted_incidents

            await wipe_promoted_incidents(session)
            await session.commit()

        orchestrator.start()

    async def start(self, name: str) -> dict[str, Any]:
        self._assert_idle()

        scenario = load_scenario(name)  # raises ScenarioNotFoundError

        # Replay requires a clean runtime — unchanged derived facts skip review open.
        await self._wipe_runtime()
        self.clear_locks()

        self._mode = "scripted"
        self._scenario_name = scenario.name
        self._step_index = 0
        self._total_steps = len(scenario.steps)
        self._started_at = datetime.now(timezone.utc)
        self._running = True
        self._random_config = None
        self._issues_spawned = 0
        self._active_issue_count = 0
        self._sources_used = []
        self._orch_sim = OrchestratorSim()

        # Pre-lock scenario assets so ambient hard-ingest cannot clear demo facts
        async with SessionLocal() as session:
            for step in scenario.steps:
                try:
                    aid = await resolve_asset_id(session, step.asset)
                    self.lock_asset(aid)
                except Exception:  # noqa: BLE001
                    logger.debug(
                        "could not pre-lock scenario asset %s", step.asset
                    )

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
        self._orch_sim = OrchestratorSim()
        self._task = asyncio.create_task(
            self._run_random(cfg), name="demo-random"
        )
        return self.status()

    async def _run(self, scenario: ScenarioFile) -> None:
        settings = get_settings()
        try:
            for i, step in enumerate(scenario.steps):
                async with SessionLocal() as session:
                    asset_id = await resolve_asset_id(session, step.asset)
                await self.wait_until_asset_active(asset_id)
                delay = (
                    step.delay_seconds
                    if step.delay_seconds is not None
                    else float(settings.simulator_default_step_delay_seconds)
                )
                if delay > 0:
                    await asyncio.sleep(delay)
                await self.wait_until_asset_active(asset_id)

                self._step_index = i
                async with SessionLocal() as session:
                    result = await self._orch_sim.run_step(
                        session,
                        step,
                        step_index=i,
                        total_steps=self._total_steps,
                    )
                    self.lock_asset(result.asset_id)
                    if result.source not in self._sources_used:
                        self._sources_used.append(result.source)
                    logger.info(
                        "demo step %d/%d via %s (%s) → review=%s facts=%s",
                        i + 1,
                        self._total_steps,
                        result.source,
                        step.category,
                        result.ingest.review.id if result.ingest.review else None,
                        [f.fact_type for f in result.ingest.derived_facts],
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
            # Keep locks until reset so ambient doesn't clear the showcase state

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
                    for aid in busy:
                        self.lock_asset(aid)
                    inactive = self.inactive_asset_ids
                    compound = (
                        busy
                        and rng.random() < config.compound_probability
                    )
                    if compound:
                        pool = [a for a in assets if a.id in busy and a.id not in inactive]
                    else:
                        pool = [a for a in assets if a.id not in busy and a.id not in inactive]
                        if not pool:
                            pool = [a for a in assets if a.id not in inactive]
                    if not pool:
                        logger.debug("random mode: all candidate assets inactive; skipping spawn")
                        continue

                    asset = rng.choice(pool)
                    signals = pick_signals(rng, config)
                    facts = await emit_issue(
                        session,
                        asset=asset,
                        signals=signals,
                        rng=rng,
                        valid_for_hours=config.valid_for_hours,
                        orch=self._orch_sim,
                    )
                    self.lock_asset(asset.id)
                    self._issues_spawned += 1
                    self._step_index = self._issues_spawned
                    self._active_issue_count = await count_open_reviews(session)
                    for src in self._orch_sim.last_sources:
                        if src not in self._sources_used:
                            self._sources_used.append(src)
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
        self._sources_used = []
        self.clear_locks()

        await self._wipe_runtime()
        logger.info("demo reset complete — runtime tables wiped")
        return {"status": "reset"}


demo_controller = DemoController()
