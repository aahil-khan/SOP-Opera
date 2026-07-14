"""DemoController — start / reset / status for YAML scenario replay."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

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


class ScenarioAlreadyRunningError(RuntimeError):
    """Raised when start() is called while a scenario is already in flight."""


class DemoController:
    """
    Singleton-ish coordinator for Demo Mode scenario replay.
    Mirrors AssessmentOrchestrator's in-process asyncio task pattern.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._scenario_name: str | None = None
        self._step_index: int = 0
        self._total_steps: int = 0
        self._started_at: datetime | None = None
        self._running: bool = False

    def status(self) -> dict:
        return {
            "scenario": self._scenario_name,
            "step_index": self._step_index,
            "total_steps": self._total_steps,
            "running": self._running,
            "started_at": (
                self._started_at.isoformat() if self._started_at else None
            ),
        }

    async def start(self, name: str) -> dict:
        if self._running and self._task is not None and not self._task.done():
            raise ScenarioAlreadyRunningError(
                f"Scenario {self._scenario_name!r} is already running; "
                "POST /demo/reset or wait for it to finish"
            )

        scenario = load_scenario(name)  # raises ScenarioNotFoundError

        self._scenario_name = scenario.name
        self._step_index = 0
        self._total_steps = len(scenario.steps)
        self._started_at = datetime.now(timezone.utc)
        self._running = True
        self._task = asyncio.create_task(
            self._run(scenario), name=f"demo-{scenario.name}"
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

    async def reset(self) -> dict:
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

        orchestrator.drain()

        async with SessionLocal() as session:
            for table in _RESET_DELETE_ORDER:
                await session.execute(text(f"DELETE FROM {table}"))
            await session.commit()

        logger.info("demo reset complete — runtime tables wiped")
        return {"status": "reset"}


demo_controller = DemoController()
