"""
The dispatcher ticker — executes armed actions and escalates unanswered pages.

Two jobs, one loop:

1. **Arming.** An action written `armed` carries `execute_after`. Once that
   passes, the action executes. The gap is the supervisor's visible abort
   window; this loop is what closes it.
2. **Escalation.** A page nobody acknowledged inside the ack timeout is escalated
   to the next contact in the chain.

## Fails closed, deliberately

If this task dies, armed actions stay armed and never execute. That is the safe
direction: the failure mode of a dead ticker is "the plant was not automatically
protected", which the supervisor can still see and act on from the rail, rather
than "actions fired unsupervised with nothing watching them". Liveness is
exposed via `dispatcher.status()` so AI Ops can surface a stalled ticker instead
of it being silently absent.

Modelled on `simulator/ambient.py` — same start/stop shape, same
`asyncio.create_task` ownership, same per-tick exception swallowing so one bad
row cannot kill the loop.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.response import repository as repo

logger = logging.getLogger(__name__)


class ResponseDispatcher:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._running = False
        self._ticks = 0
        self._executed = 0
        self._escalated = 0
        self._last_tick_at: datetime | None = None
        self._last_error: str | None = None

    @property
    def running(self) -> bool:
        return self._running and self._task is not None and not self._task.done()

    def status(self) -> dict[str, Any]:
        """Liveness for AI Ops. A stalled ticker must be visible, not inferred."""
        return {
            "running": self.running,
            "ticks": self._ticks,
            "actions_executed": self._executed,
            "pages_escalated": self._escalated,
            "last_tick_at": (
                self._last_tick_at.isoformat() if self._last_tick_at else None
            ),
            "last_error": self._last_error,
        }

    def start(self) -> asyncio.Task | None:
        if self.running:
            return self._task
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="response-dispatcher")
        logger.info("response dispatcher started")
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
        logger.info("response dispatcher stopped")

    async def _loop(self) -> None:
        settings = get_settings()
        while self._running:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                # One bad row must not take the loop down — that would silently
                # strand every subsequent armed action.
                self._last_error = str(exc)
                logger.exception("response dispatcher tick failed")
            await asyncio.sleep(settings.response_tick_seconds)

    async def tick(self) -> dict[str, int]:
        """
        One pass. Separated from the loop so tests can drive it directly rather
        than waiting on wall-clock.
        """
        settings = get_settings()
        self._ticks += 1
        self._last_tick_at = datetime.now(timezone.utc)
        executed = 0
        escalated = 0

        # Deferred: importing service at module load would pull the realtime
        # manager into every consumer of this module.
        from app.response.service import escalate_page, execute_action

        async with SessionLocal() as session:
            due = await repo.due_armed_actions(session)
            for action in due:
                full = await repo.get_action(session, action["id"])
                if full is None:
                    continue
                if await execute_action(session, full):
                    executed += 1
            if due:
                await session.commit()

        async with SessionLocal() as session:
            stale = await repo.unacknowledged_pages(
                session,
                older_than_seconds=settings.response_page_ack_timeout_seconds,
            )
            for page in stale:
                await escalate_page(session, page)
                escalated += 1
            if stale:
                await session.commit()

        self._executed += executed
        self._escalated += escalated
        self._last_error = None
        return {"executed": executed, "escalated": escalated}


dispatcher = ResponseDispatcher()
