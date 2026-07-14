"""Assessment Orchestrator — owns pending jobs + the in-process worker loop."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from shared.python.schemas import Review

logger = logging.getLogger(__name__)

PROMPT_VERSION = "assessment-v1"


class AssessmentOrchestrator:
    """Singleton-ish coordinator: enqueue pending assessment rows and drain them."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[UUID] = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None
        self._provider_override: dict[UUID, str] = {}

    def set_provider_override(self, assessment_id: UUID, provider: str) -> None:
        self._provider_override[assessment_id] = provider

    def pop_provider_override(self, assessment_id: UUID) -> str | None:
        return self._provider_override.pop(assessment_id, None)

    def enqueue(self, assessment_id: UUID) -> None:
        self._queue.put_nowait(assessment_id)

    async def recover_pending(self) -> int:
        """
        Re-queue assessments stuck in pending OR generating (crash/restart recovery).
        A 'generating' row means a previous worker claimed it and died mid-job;
        reset it to pending so run_assessment_job's own claim step re-claims it
        cleanly instead of leaving it permanently stuck (which would also block
        enqueue_for_review's pending/generating idempotency guard forever).
        """
        async with SessionLocal() as session:
            await session.execute(
                text(
                    """
                    UPDATE assessments SET status = 'pending'
                    WHERE status = 'generating'
                    """
                )
            )
            await session.commit()
            result = await session.execute(
                text(
                    """
                    SELECT id FROM assessments
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    """
                )
            )
            ids = [row._mapping["id"] for row in result.fetchall()]
        for aid in ids:
            self.enqueue(aid)
        if ids:
            logger.info("recovered %d pending/generating assessment job(s)", len(ids))
        return len(ids)

    async def worker_loop(self) -> None:
        from app.assessment.pipeline import run_assessment_job

        await self.recover_pending()
        logger.info("assessment worker started")
        while True:
            assessment_id = await self._queue.get()
            try:
                override = self.pop_provider_override(assessment_id)
                await run_assessment_job(assessment_id, provider_name=override)
            except Exception:  # noqa: BLE001 — never kill the worker
                logger.exception(
                    "assessment job %s crashed; leaving row for retry/manual",
                    assessment_id,
                )
            finally:
                self._queue.task_done()

    def start(self) -> asyncio.Task:
        # pytest-asyncio creates a fresh loop per test; queues/tasks are loop-bound.
        if self._worker_task is not None and not self._worker_task.done():
            self._worker_task.cancel()
        self._queue = asyncio.Queue()
        self._worker_task = asyncio.create_task(
            self.worker_loop(), name="assessment-worker"
        )
        return self._worker_task

    def stop(self) -> None:
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            self._worker_task = None

    def drain(self) -> None:
        """Empty the queue and pending provider overrides (used by Demo reset)."""
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            try:
                self._queue.task_done()
            except ValueError:
                pass
        self._provider_override.clear()


orchestrator = AssessmentOrchestrator()


async def _true_fact_ids(session: AsyncSession, asset_id: UUID) -> list[UUID]:
    result = await session.execute(
        text(
            """
            SELECT DISTINCT ON (fact_type)
                id, value
            FROM derived_facts
            WHERE asset_id = CAST(:asset_id AS uuid)
            ORDER BY fact_type, computed_at DESC
            """
        ),
        {"asset_id": str(asset_id)},
    )
    ids: list[UUID] = []
    for row in result.fetchall():
        m = row._mapping
        value = m["value"]
        if isinstance(value, dict):
            value = value.get("value", value)
        if value is True or value == "true":
            ids.append(m["id"])
    return ids


async def enqueue_for_review(
    session: AsyncSession,
    review: Review,
    *,
    provider_override: str | None = None,
) -> UUID | None:
    """
    Insert a pending AI assessment for this review and enqueue it.
    Idempotent: skips if a pending/generating assessment already exists.
    """
    existing = await session.execute(
        text(
            """
            SELECT id FROM assessments
            WHERE review_id = CAST(:review_id AS uuid)
              AND status IN ('pending', 'generating')
            LIMIT 1
            """
        ),
        {"review_id": str(review.id)},
    )
    if existing.first() is not None:
        logger.debug(
            "skip enqueue — assessment already in flight for review %s", review.id
        )
        return None

    fact_ids = await _true_fact_ids(session, review.asset_id)
    ver_row = await session.execute(
        text(
            """
            SELECT COALESCE(MAX(version), 0) AS v
            FROM assessments
            WHERE review_id = CAST(:review_id AS uuid)
            """
        ),
        {"review_id": str(review.id)},
    )
    version = int(ver_row.scalar_one()) + 1

    result = await session.execute(
        text(
            """
            INSERT INTO assessments (
                review_id, assessment_type, status, derived_fact_ids, version
            )
            VALUES (
                CAST(:review_id AS uuid),
                'ai',
                'pending',
                CAST(:fact_ids AS uuid[]),
                :version
            )
            RETURNING id
            """
        ),
        {
            "review_id": str(review.id),
            "fact_ids": [str(i) for i in fact_ids],
            "version": version,
        },
    )
    assessment_id = result.scalar_one()
    await session.commit()

    if provider_override:
        orchestrator.set_provider_override(assessment_id, provider_override)
    orchestrator.enqueue(assessment_id)
    logger.info(
        "enqueued assessment %s for review %s (v%d)",
        assessment_id,
        review.id,
        version,
    )
    return assessment_id
