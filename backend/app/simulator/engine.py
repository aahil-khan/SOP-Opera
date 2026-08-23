"""DemoController — start / reset / status for YAML scenario replay and Random Mode."""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import text

from app.assessment.orchestrator import orchestrator
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.simulator.dsl import (
    ScenarioFile,
    ScenarioStep,
    load_scenario,
    resolve_asset_id,
    step_display_label,
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

logger = logging.getLogger(__name__)

# FK-safe wipe order for runtime (demo) tables. Master/seed data is left intact.
# ai_ops_events is intentionally excluded — append-only pipeline analytics.
# Demo reset clears live runtime rows but must NOT delete mock/demonstration
# data (reviews.is_seeded — see schema.sql and scripts/quick_mock_seed.py).
# Seeded rows are hidden/shown by the seeded-mode toggle instead; a reset
# turns that toggle off rather than destroying the corpus, so a year of
# seeded history survives any number of demo resets.
#
# Ordering is FK-driven (children before parents) and unchanged; only the
# scoping is new. Response rows reference reviews (and each other), so they
# clear first — response_devices / response_contacts are seeded reference
# data and stay, the same way assets and workers do, but their *state* is
# reset separately by reset_device_states() so a demo does not start with a
# fan left on. Tables with no link back to `reviews` are handled by their own
# marker: context_entries/derived_facts by provider, and telemetry_samples/
# audit_entries wholesale (the mock seeder writes neither).
_REAL_REVIEWS = "(SELECT id FROM reviews WHERE NOT is_seeded)"
_REAL_ASSESSMENTS = f"(SELECT id FROM assessments WHERE review_id IN {_REAL_REVIEWS})"
_MOCK_PROVIDER = "quick_mock"

_RESET_DELETE_STATEMENTS = (
    f"DELETE FROM response_pages WHERE review_id IN {_REAL_REVIEWS}",
    f"DELETE FROM response_actions WHERE review_id IN {_REAL_REVIEWS}",
    f"DELETE FROM evidence WHERE review_id IN {_REAL_REVIEWS}",
    f"DELETE FROM review_tasks WHERE review_id IN {_REAL_REVIEWS}",
    f"DELETE FROM review_comments WHERE review_id IN {_REAL_REVIEWS}",
    f"DELETE FROM decisions WHERE review_id IN {_REAL_REVIEWS}",
    f"DELETE FROM recommendations WHERE assessment_id IN {_REAL_ASSESSMENTS}",
    f"DELETE FROM assessment_metadata WHERE assessment_id IN {_REAL_ASSESSMENTS}",
    f"DELETE FROM assessments WHERE review_id IN {_REAL_REVIEWS}",
    f"DELETE FROM reports WHERE review_id IN {_REAL_REVIEWS}",
    f"DELETE FROM notifications WHERE review_id IS NULL OR review_id IN {_REAL_REVIEWS}",
    "DELETE FROM reviews WHERE NOT is_seeded",
    # derived_facts has no review_id; its rows are matched through the context
    # entries that produced them, so seeded facts survive with their context.
    f"""DELETE FROM derived_facts WHERE NOT (source_context_ids && (
            SELECT COALESCE(array_agg(id), '{{}}') FROM context_entries
            WHERE provider = '{_MOCK_PROVIDER}'
        ))""",
    f"DELETE FROM context_entries WHERE provider <> '{_MOCK_PROVIDER}'",
    "DELETE FROM telemetry_samples",
    "DELETE FROM audit_entries",
)

DemoMode = Literal["idle", "scripted", "random"]
PlaybackMode = Literal["auto", "manual"]


class ScenarioAlreadyRunningError(RuntimeError):
    """Raised when start/arm is called while a scenario is already in flight."""


class ScenarioNotArmedError(RuntimeError):
    """Raised when step() is called without an armed manual scenario."""


class ScenarioCompleteError(RuntimeError):
    """Raised when step() is called but every step has already been emitted."""


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
        self._playback: PlaybackMode | None = None
        self._manual_scenario: ScenarioFile | None = None
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

        next_label: str | None = None
        if (
            self._playback == "manual"
            and self._manual_scenario is not None
            and self._step_index < self._total_steps
        ):
            next_label = step_display_label(
                self._manual_scenario.steps[self._step_index]
            )

        return {
            "mode": self._mode,
            "playback": self._playback,
            "scenario": self._scenario_name,
            "step_index": self._step_index,
            "total_steps": self._total_steps,
            "running": self._running,
            "next_step_label": next_label,
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
        auto_running = (
            self._running and self._task is not None and not self._task.done()
        )
        manual_armed = (
            self._playback == "manual" and self._manual_scenario is not None
        )
        if auto_running or manual_armed:
            raise ScenarioAlreadyRunningError(
                f"Demo mode {self._mode!r} "
                f"({self._scenario_name or 'random'}) is already running; "
                "POST /demo/reset or wait for it to finish"
            )

    async def _prepare_scripted(self, scenario: ScenarioFile) -> None:
        """Wipe runtime, lock assets, and stamp shared scripted session fields."""
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

        async with SessionLocal() as session:
            for step in scenario.steps:
                try:
                    aid = await resolve_asset_id(session, step.asset)
                    self.lock_asset(aid)
                except Exception:  # noqa: BLE001
                    logger.debug(
                        "could not pre-lock scenario asset %s", step.asset
                    )

    async def _emit_step(self, step: ScenarioStep, step_index: int) -> None:
        async with SessionLocal() as session:
            asset_id = await resolve_asset_id(session, step.asset)
        await self.wait_until_asset_active(asset_id)

        async with SessionLocal() as session:
            result = await self._orch_sim.run_step(
                session,
                step,
                step_index=step_index,
                total_steps=self._total_steps,
            )
            self.lock_asset(result.asset_id)
            if result.source not in self._sources_used:
                self._sources_used.append(result.source)
            logger.info(
                "demo step %d/%d via %s (%s) → review=%s facts=%s",
                step_index + 1,
                self._total_steps,
                result.source,
                step.category,
                result.ingest.review.id if result.ingest.review else None,
                [f.fact_type for f in result.ingest.derived_facts],
            )

    async def _wipe_runtime(self) -> None:
        """
        Delete live demo runtime rows so scenarios can replay cleanly.

        Mock/demonstration rows (reviews.is_seeded) are deliberately preserved —
        a reset turns seeded mode *off* rather than destroying the corpus. See
        _RESET_DELETE_STATEMENTS.
        """
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
            for stmt in _RESET_DELETE_STATEMENTS:
                await session.execute(text(stmt))
            # Seeded near-misses stay; live closures promoted during the last run go.
            from app.incidents.service import wipe_promoted_incidents

            await wipe_promoted_incidents(session)

            # Devices survive the wipe (seeded reference data), but their *state*
            # must not: a fan left running or a gate left shut from the previous
            # run would start the next demo mid-incident.
            from app.response.repository import reset_device_states

            await reset_device_states(session)
            await session.commit()

        # A reset returns the plant to a clean live state, so the mock corpus
        # should not be showing afterwards — hide it rather than delete it.
        from app.db.session import set_seeded_mode

        set_seeded_mode(False)

        orchestrator.start()

    async def start(self, name: str) -> dict[str, Any]:
        """Auto-play a scenario (timed delays). Used by the Grand Tour."""
        self._assert_idle()

        scenario = load_scenario(name)  # raises ScenarioNotFoundError
        await self._prepare_scripted(scenario)
        self._playback = "auto"
        self._manual_scenario = None

        self._task = asyncio.create_task(
            self._run(scenario), name=f"demo-{scenario.name}"
        )
        return self.status()

    async def arm(self, name: str) -> dict[str, Any]:
        """
        Load a scenario for manual step-through. Emits nothing until step().

        Preferred for live demos / video narration — each beat waits for a click.
        """
        self._assert_idle()

        scenario = load_scenario(name)
        await self._prepare_scripted(scenario)
        self._playback = "manual"
        self._manual_scenario = scenario
        self._task = None
        return self.status()

    async def step(self) -> dict[str, Any]:
        """Emit the next armed manual step immediately (no delay)."""
        if self._playback != "manual" or self._manual_scenario is None:
            raise ScenarioNotArmedError(
                "No manual scenario armed; POST /demo/scenarios/{name}/arm first"
            )
        if self._step_index >= self._total_steps:
            raise ScenarioCompleteError(
                f"Scenario {self._scenario_name!r} has no remaining steps"
            )

        i = self._step_index
        step = self._manual_scenario.steps[i]
        await self._emit_step(step, i)
        self._step_index = i + 1
        if self._step_index >= self._total_steps:
            self._running = False
        return self.status()

    async def start_random(
        self, config: RandomModeConfig | None = None
    ) -> dict[str, Any]:
        self._assert_idle()
        cfg = config or default_config_from_settings()
        self._mode = "random"
        self._playback = "auto"
        self._manual_scenario = None
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
                await self._emit_step(step, i)
                self._step_index = i + 1
        except asyncio.CancelledError:
            logger.info("demo scenario %s cancelled", scenario.name)
            raise
        except Exception:
            logger.exception(
                "demo scenario %s failed at step %d",
                scenario.name,
                self._step_index,
            )
        finally:
            self._running = False
            if self._mode == "scripted" and self._playback == "auto":
                self._mode = "idle"
                self._playback = None
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
                    signals = pick_signals(rng, config, asset.sensor_kinds)
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
        except Exception:
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
        self._playback = None
        self._manual_scenario = None
        self._random_config = None
        self._issues_spawned = 0
        self._active_issue_count = 0
        self._sources_used = []
        self.clear_locks()

        await self._wipe_runtime()
        logger.info("demo reset complete — runtime tables wiped")
        return {"status": "reset"}


demo_controller = DemoController()
