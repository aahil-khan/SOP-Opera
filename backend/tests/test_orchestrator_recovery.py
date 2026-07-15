"""Crash/restart recovery: recover_pending() must reclaim both 'pending' and
'generating' assessment rows, not just 'pending' ones (a 'generating' row means a
previous worker claimed the job and died mid-flight — it must not be stranded)."""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.assessment.orchestrator import AssessmentOrchestrator
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest_asyncio.fixture
async def session():
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn
    import asyncpg

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()

    from app.db.seed import seed_minimal

    await seed_minimal()

    async with SessionLocal() as s:
        await s.execute(text("DELETE FROM assessment_metadata"))
        await s.execute(text("DELETE FROM recommendations"))
        await s.execute(text("DELETE FROM assessments"))
        await s.execute(text("DELETE FROM notifications"))
        await s.execute(text("DELETE FROM reports"))
        await s.execute(text("DELETE FROM evidence"))
        await s.execute(text("DELETE FROM decisions"))
        await s.execute(
            text("DELETE FROM reviews WHERE asset_id = CAST(:aid AS uuid)"),
            {"aid": str(VESSEL_A)},
        )
        await s.commit()
        yield s
        await s.execute(text("DELETE FROM assessment_metadata"))
        await s.execute(text("DELETE FROM recommendations"))
        await s.execute(text("DELETE FROM assessments"))
        await s.execute(text("DELETE FROM notifications"))
        await s.execute(text("DELETE FROM reports"))
        await s.execute(text("DELETE FROM evidence"))
        await s.execute(text("DELETE FROM decisions"))
        await s.execute(
            text("DELETE FROM reviews WHERE asset_id = CAST(:aid AS uuid)"),
            {"aid": str(VESSEL_A)},
        )
        await s.commit()
    await close_vector_pool()
    await engine.dispose()


async def _make_review(session, state: str) -> UUID:
    result = await session.execute(
        text(
            """
            INSERT INTO reviews (asset_id, state, triggered_by, owner_id)
            VALUES (
                CAST(:aid AS uuid), :state, 'test',
                (SELECT id FROM users LIMIT 1)
            )
            RETURNING id
            """
        ),
        {"aid": str(VESSEL_A), "state": state},
    )
    return result.scalar_one()


async def _make_assessment(session, review_id: UUID, status: str, version: int) -> UUID:
    result = await session.execute(
        text(
            """
            INSERT INTO assessments (review_id, assessment_type, status, version)
            VALUES (CAST(:rid AS uuid), 'ai', :status, :version)
            RETURNING id
            """
        ),
        {"rid": str(review_id), "status": status, "version": version},
    )
    return result.scalar_one()


@pytest.mark.asyncio
async def test_recover_pending_reclaims_pending_and_generating(session):
    review_id = await _make_review(session, "assessing")
    pending_id = await _make_assessment(session, review_id, "pending", 1)
    generating_id = await _make_assessment(session, review_id, "generating", 2)
    complete_id = await _make_assessment(session, review_id, "complete", 3)
    await session.commit()

    orch = AssessmentOrchestrator()
    recovered = await orch.recover_pending()
    assert recovered == 2

    queued: set[UUID] = set()
    while not orch._queue.empty():
        queued.add(orch._queue.get_nowait())
    assert queued == {pending_id, generating_id}
    assert complete_id not in queued

    # The previously-'generating' row must be reset to 'pending' in the DB too,
    # otherwise enqueue_for_review's idempotency guard (pending/generating) would
    # never let a fresh job in and it would stay invisible to future recovery scans.
    row = await session.execute(
        text("SELECT status FROM assessments WHERE id = CAST(:id AS uuid)"),
        {"id": str(generating_id)},
    )
    assert row.scalar_one() == "pending"


@pytest.mark.asyncio
async def test_recover_pending_noop_when_nothing_stuck(session):
    review_id = await _make_review(session, "pending_decision")
    await _make_assessment(session, review_id, "complete", 1)
    await session.commit()

    orch = AssessmentOrchestrator()
    recovered = await orch.recover_pending()
    assert recovered == 0
    assert orch._queue.empty()
