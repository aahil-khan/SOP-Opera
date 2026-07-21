"""Assessment Orchestrator — durable Postgres-backed job queue + worker pool."""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal
from shared.python.schemas import Review

logger = logging.getLogger(__name__)

PROMPT_VERSION = "assessment-v2-langgraph"
POLL_INTERVAL_SECONDS = 0.75


class AssessmentOrchestrator:
    """
    Coordinator: enqueue pending assessment rows and drain them with N workers.

    Wake path: in-memory asyncio.Queue (low latency after ingest).
    Durable path: workers also poll `assessments` with FOR UPDATE SKIP LOCKED
    so jobs survive restarts and concurrent workers do not double-run.
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[UUID | None] = asyncio.Queue()
        self._worker_tasks: list[asyncio.Task] = []
        self._provider_override: dict[UUID, str] = {}
        self._wake = asyncio.Event()

    def set_provider_override(self, assessment_id: UUID, provider: str) -> None:
        self._provider_override[assessment_id] = provider

    def pop_provider_override(self, assessment_id: UUID) -> str | None:
        return self._provider_override.pop(assessment_id, None)

    def enqueue(self, assessment_id: UUID) -> None:
        self._queue.put_nowait(assessment_id)
        self._wake.set()

    async def recover_pending(self) -> int:
        """
        Re-queue assessments stuck in pending OR generating (crash/restart recovery).
        A 'generating' row means a previous worker claimed it and died mid-job;
        reset it to pending so SKIP LOCKED claim can re-take it.

        Jobs whose review has already left `assessing` are superseded — otherwise
        restart would re-run them and crash on assessment_completed.
        """
        async with SessionLocal() as session:
            stale = await session.execute(
                text(
                    """
                    UPDATE assessments a
                    SET status = 'superseded',
                        summary = COALESCE(
                            a.summary,
                            'Skipped: review no longer assessing'
                        )
                    WHERE a.status IN ('pending', 'generating')
                      AND EXISTS (
                          SELECT 1 FROM reviews r
                          WHERE r.id = a.review_id
                            AND r.state <> 'assessing'
                      )
                    RETURNING a.id
                    """
                )
            )
            stale_ids = [row._mapping["id"] for row in stale.fetchall()]
            if stale_ids:
                logger.info(
                    "superseded %d stale assessment job(s) (review left assessing)",
                    len(stale_ids),
                )

            await session.execute(
                text(
                    """
                    UPDATE assessments a
                    SET status = 'pending'
                    WHERE a.status = 'generating'
                      AND EXISTS (
                          SELECT 1 FROM reviews r
                          WHERE r.id = a.review_id
                            AND r.state = 'assessing'
                      )
                    """
                )
            )
            await session.commit()
            result = await session.execute(
                text(
                    """
                    SELECT a.id
                    FROM assessments a
                    JOIN reviews r ON r.id = a.review_id
                    WHERE a.status = 'pending'
                      AND r.state = 'assessing'
                    ORDER BY a.created_at ASC
                    """
                )
            )
            ids = [row._mapping["id"] for row in result.fetchall()]
        for aid in ids:
            self.enqueue(aid)
        if ids:
            logger.info("recovered %d pending/generating assessment job(s)", len(ids))
        return len(ids)

    async def claim_next_pending(self) -> UUID | None:
        """Atomically claim the oldest pending assessment (multi-worker safe).

        Only claims jobs whose review is still `assessing` — otherwise a stale
        pending row for a decided/closed review would burn a worker cycle and
        risk an illegal assessment_completed transition.
        """
        async with SessionLocal() as session:
            # Drop stale pending/generating jobs before claiming.
            await session.execute(
                text(
                    """
                    UPDATE assessments a
                    SET status = 'superseded',
                        summary = COALESCE(
                            a.summary,
                            'Skipped: review no longer assessing'
                        )
                    WHERE a.status IN ('pending', 'generating')
                      AND EXISTS (
                          SELECT 1 FROM reviews r
                          WHERE r.id = a.review_id
                            AND r.state <> 'assessing'
                      )
                    """
                )
            )
            result = await session.execute(
                text(
                    """
                    UPDATE assessments SET status = 'generating'
                    WHERE id = (
                        SELECT a.id
                        FROM assessments a
                        JOIN reviews r ON r.id = a.review_id
                        WHERE a.status = 'pending'
                          AND r.state = 'assessing'
                        ORDER BY a.created_at ASC
                        FOR UPDATE OF a SKIP LOCKED
                        LIMIT 1
                    )
                    RETURNING id
                    """
                )
            )
            row = result.first()
            await session.commit()
            if row is None:
                return None
            return row._mapping["id"]

    async def queue_snapshot(self) -> dict:
        async with SessionLocal() as session:
            result = await session.execute(
                text(
                    """
                    SELECT status, COUNT(*)::int AS n
                    FROM assessments
                    WHERE status IN ('pending', 'generating')
                    GROUP BY status
                    """
                )
            )
            counts = {row._mapping["status"]: row._mapping["n"] for row in result.fetchall()}
            pending_rows = await session.execute(
                text(
                    """
                    SELECT id, review_id, created_at
                    FROM assessments
                    WHERE status IN ('pending', 'generating')
                    ORDER BY created_at ASC
                    LIMIT 20
                    """
                )
            )
            jobs = [
                {
                    "assessment_id": str(m["id"]),
                    "review_id": str(m["review_id"]),
                    "created_at": m["created_at"].isoformat()
                    if hasattr(m["created_at"], "isoformat")
                    else str(m["created_at"]),
                }
                for m in (r._mapping for r in pending_rows.fetchall())
            ]
        return {
            "pending": counts.get("pending", 0),
            "generating": counts.get("generating", 0),
            "workers": len([t for t in self._worker_tasks if not t.done()]),
            "memory_queue_size": self._queue.qsize(),
            "jobs": jobs,
        }

    async def worker_loop(self, worker_id: int) -> None:
        from app.assessment.pipeline import run_assessment_job

        logger.info("assessment worker-%d started", worker_id)
        while True:
            preclaimed = False
            try:
                assessment_id = await asyncio.wait_for(
                    self._queue.get(), timeout=POLL_INTERVAL_SECONDS
                )
            except TimeoutError:
                assessment_id = await self.claim_next_pending()
                preclaimed = assessment_id is not None
            if assessment_id is None:
                continue
            try:
                override = self.pop_provider_override(assessment_id)
                await run_assessment_job(
                    assessment_id,
                    provider_name=override,
                    preclaimed=preclaimed,
                )
            except Exception:  # noqa: BLE001 — never kill the worker
                logger.exception(
                    "worker-%d assessment job %s crashed; leaving row for retry/manual",
                    worker_id,
                    assessment_id,
                )
            finally:
                if not preclaimed:
                    try:
                        self._queue.task_done()
                    except ValueError:
                        pass

    def start(self) -> asyncio.Task:
        # pytest-asyncio creates a fresh loop per test; queues/tasks are loop-bound.
        self.stop()
        self._queue = asyncio.Queue()
        self._wake = asyncio.Event()
        n = max(1, int(get_settings().assessment_worker_count))

        async def _boot() -> None:
            await self.recover_pending()
            self._worker_tasks = [
                asyncio.create_task(
                    self.worker_loop(i), name=f"assessment-worker-{i}"
                )
                for i in range(n)
            ]
            logger.info("assessment worker pool running (%d workers)", n)
            await asyncio.gather(*self._worker_tasks)

        self._boot_task = asyncio.create_task(_boot(), name="assessment-worker-pool")
        return self._boot_task

    def stop(self) -> None:
        for task in self._worker_tasks:
            if not task.done():
                task.cancel()
        self._worker_tasks = []
        boot = getattr(self, "_boot_task", None)
        if boot is not None and not boot.done():
            boot.cancel()
        self._boot_task = None

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
