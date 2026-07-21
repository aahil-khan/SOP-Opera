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
        # Children before parents, following the FK graph in schema.sql:
        #   review_tasks -> decisions -> assessments -> reviews
        #   evidence     -> decisions, assessments, reviews
        # The original order cleared assessments first, which fails as soon as
        # another test file has left a decision behind, and never covered
        # review_tasks at all (that table was added after this fixture).
        await s.execute(text("DELETE FROM evidence"))
        await s.execute(text("DELETE FROM review_tasks"))
        await s.execute(text("DELETE FROM decisions"))
        await s.execute(text("DELETE FROM reports"))
        await s.execute(text("DELETE FROM notifications"))
        await s.execute(text("DELETE FROM review_comments"))
        await s.execute(text("DELETE FROM recommendations"))
        await s.execute(text("DELETE FROM assessment_metadata"))
        await s.execute(text("DELETE FROM assessments"))
        await s.execute(
            text("DELETE FROM reviews WHERE asset_id = CAST(:aid AS uuid)"),
            {"aid": str(VESSEL_A)},
        )
        await s.commit()
        yield s
        # Children before parents, following the FK graph in schema.sql:
        #   review_tasks -> decisions -> assessments -> reviews
        #   evidence     -> decisions, assessments, reviews
        # The original order cleared assessments first, which fails as soon as
        # another test file has left a decision behind, and never covered
        # review_tasks at all (that table was added after this fixture).
        await s.execute(text("DELETE FROM evidence"))
        await s.execute(text("DELETE FROM review_tasks"))
        await s.execute(text("DELETE FROM decisions"))
        await s.execute(text("DELETE FROM reports"))
        await s.execute(text("DELETE FROM notifications"))
        await s.execute(text("DELETE FROM review_comments"))
        await s.execute(text("DELETE FROM recommendations"))
        await s.execute(text("DELETE FROM assessment_metadata"))
        await s.execute(text("DELETE FROM assessments"))
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
    # One in-flight job per review: the partial unique index on
    # assessments(review_id) WHERE status IN ('pending','generating') makes a
    # pending *and* a generating row for the same review impossible, which is the
    # invariant the queue always relied on and now enforces.
    pending_review = await _make_review(session, "assessing")
    generating_review = await _make_review(session, "assessing")

    pending_id = await _make_assessment(session, pending_review, "pending", 1)
    generating_id = await _make_assessment(session, generating_review, "generating", 1)
    complete_id = await _make_assessment(session, pending_review, "complete", 2)
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
async def test_recover_pending_supersedes_jobs_for_non_assessing_reviews(session):
    """Restart must not re-queue jobs whose review already left assessing."""
    decided_id = await _make_review(session, "decided")
    closed_id = await _make_review(session, "closed")
    assessing_id = await _make_review(session, "assessing")

    stale_pending = await _make_assessment(session, decided_id, "pending", 1)
    stale_generating = await _make_assessment(session, closed_id, "generating", 1)
    live = await _make_assessment(session, assessing_id, "pending", 1)
    await session.commit()

    orch = AssessmentOrchestrator()
    recovered = await orch.recover_pending()
    assert recovered == 1

    queued: set[UUID] = set()
    while not orch._queue.empty():
        queued.add(orch._queue.get_nowait())
    assert queued == {live}

    for aid in (stale_pending, stale_generating):
        row = await session.execute(
            text("SELECT status FROM assessments WHERE id = CAST(:id AS uuid)"),
            {"id": str(aid)},
        )
        assert row.scalar_one() == "superseded"


@pytest.mark.asyncio
async def test_recover_pending_noop_when_nothing_stuck(session):
    review_id = await _make_review(session, "pending_decision")
    await _make_assessment(session, review_id, "complete", 1)
    await session.commit()

    orch = AssessmentOrchestrator()
    recovered = await orch.recover_pending()
    assert recovered == 0
    assert orch._queue.empty()


@pytest.mark.asyncio
async def test_claim_next_pending_skips_decided_reviews(session):
    """Poll path must not claim jobs whose review already left assessing."""
    decided_id = await _make_review(session, "decided")
    assessing_id = await _make_review(session, "assessing")
    stale = await _make_assessment(session, decided_id, "pending", 1)
    live = await _make_assessment(session, assessing_id, "pending", 1)
    await session.commit()

    orch = AssessmentOrchestrator()
    claimed = await orch.claim_next_pending()
    assert claimed == live

    row = await session.execute(
        text("SELECT status FROM assessments WHERE id = CAST(:id AS uuid)"),
        {"id": str(stale)},
    )
    assert row.scalar_one() == "superseded"

    row = await session.execute(
        text("SELECT status FROM assessments WHERE id = CAST(:id AS uuid)"),
        {"id": str(live)},
    )
    assert row.scalar_one() == "generating"


@pytest.mark.asyncio
async def test_run_assessment_job_skips_when_review_already_decided(session):
    """In-flight / queued job must not crash on assessment_completed after decide."""
    from app.assessment.pipeline import run_assessment_job

    review_id = await _make_review(session, "decided")
    assessment_id = await _make_assessment(session, review_id, "generating", 1)
    await session.commit()

    await run_assessment_job(assessment_id, preclaimed=True)

    row = await session.execute(
        text("SELECT status, summary FROM assessments WHERE id = CAST(:id AS uuid)"),
        {"id": str(assessment_id)},
    )
    m = row.one()._mapping
    assert m["status"] == "superseded"
    assert "left assessing" in (m["summary"] or "")
