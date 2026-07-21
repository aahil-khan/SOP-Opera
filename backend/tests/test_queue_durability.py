"""Assessment queue durability — lease reclaim and enqueue idempotency."""

from __future__ import annotations

from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.assessment.orchestrator import enqueue_for_review, orchestrator
from app.db.seed import seed_minimal
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool
from shared.python.schemas import Review


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
    await seed_minimal()
    async with SessionLocal() as s:
        # These tests assert on *which* job the queue hands back, so the queue
        # must be empty at start. Backend suites share global tables, and a
        # pending row left by another file would be claimed ahead of ours.
        await s.execute(
            text(
                """
                UPDATE assessments SET status = 'superseded'
                WHERE status IN ('pending', 'generating')
                """
            )
        )
        await s.commit()
        yield s
    await close_vector_pool()
    await engine.dispose()


async def _make_assessing_review(session) -> Review:
    """A review already in `assessing`, on whichever asset the seed provides."""
    row = await session.execute(
        text(
            """
            INSERT INTO reviews (asset_id, state, triggered_by, owner_id)
            VALUES (
                (SELECT id FROM assets ORDER BY name LIMIT 1), 'assessing', 'test',
                (SELECT id FROM users LIMIT 1)
            )
            RETURNING id, asset_id, state, owner_id, triggered_by, origin,
                      raised_by_worker_id, created_at
            """
        )
    )
    m = row.first()._mapping
    await session.commit()
    return Review(
        id=m["id"],
        asset_id=m["asset_id"],
        state=m["state"],
        owner_id=m["owner_id"],
        triggered_by=m["triggered_by"],
        origin=m["origin"],
        raised_by_worker_id=m["raised_by_worker_id"],
        created_at=m["created_at"],
    )


@pytest.mark.asyncio
async def test_concurrent_enqueue_creates_only_one_job(session):
    """
    Idempotency is enforced by the partial unique index, not a prior SELECT.

    The old check-then-insert let two concurrent `assessing` transitions both
    pass the check and insert two pending assessments for one review.
    """
    review = await _make_assessing_review(session)

    first = await enqueue_for_review(session, review)
    second = await enqueue_for_review(session, review)

    assert first is not None
    assert second is None, "second enqueue should be rejected while one is in flight"

    count = await session.execute(
        text(
            """
            SELECT COUNT(*)::int FROM assessments
            WHERE review_id = CAST(:rid AS uuid)
              AND status IN ('pending', 'generating')
            """
        ),
        {"rid": str(review.id)},
    )
    assert count.scalar_one() == 1


@pytest.mark.asyncio
async def test_unique_index_rejects_a_second_in_flight_row(session):
    """Guard the constraint itself, not just the code path above it."""
    review = await _make_assessing_review(session)
    await enqueue_for_review(session, review)

    with pytest.raises(Exception):
        await session.execute(
            text(
                """
                INSERT INTO assessments (review_id, assessment_type, status, version)
                VALUES (CAST(:rid AS uuid), 'ai', 'pending', 99)
                """
            ),
            {"rid": str(review.id)},
        )
        await session.commit()
    await session.rollback()


@pytest.mark.asyncio
async def test_expired_lease_is_reclaimed(session):
    """
    A worker that dies mid-job leaves `generating` behind. Without a lease the
    row — and its review — stayed stuck until the next process restart.
    """
    review = await _make_assessing_review(session)
    assessment_id = await enqueue_for_review(session, review)
    assert assessment_id is not None

    # Simulate a worker that claimed the job long ago and never finished.
    await session.execute(
        text(
            """
            UPDATE assessments
            SET status = 'generating',
                claimed_at = now() - interval '1 day'
            WHERE id = CAST(:aid AS uuid)
            """
        ),
        {"aid": str(assessment_id)},
    )
    await session.commit()

    claimed = await orchestrator.claim_next_pending()
    assert claimed == assessment_id, "expired lease was not reclaimed"

    row = await session.execute(
        text("SELECT status, claimed_at FROM assessments WHERE id = CAST(:aid AS uuid)"),
        {"aid": str(assessment_id)},
    )
    m = row.first()._mapping
    assert m["status"] == "generating"
    assert m["claimed_at"] is not None, "reclaim must stamp a fresh lease"


@pytest.mark.asyncio
async def test_healthy_claim_is_not_stolen(session):
    """A job inside its lease window must not be reclaimed from a live worker."""
    review = await _make_assessing_review(session)
    assessment_id = await enqueue_for_review(session, review)

    await session.execute(
        text(
            """
            UPDATE assessments
            SET status = 'generating', claimed_at = now()
            WHERE id = CAST(:aid AS uuid)
            """
        ),
        {"aid": str(assessment_id)},
    )
    await session.commit()

    assert await orchestrator.claim_next_pending() is None


@pytest.mark.asyncio
async def test_provider_override_survives_on_the_job_row(session):
    """
    The override used to live only in a module-level dict, so another worker
    process would silently run with the default provider.
    """
    review = await _make_assessing_review(session)
    assessment_id = await enqueue_for_review(
        session, review, provider_override="ollama"
    )

    stored = await session.execute(
        text("SELECT provider_override FROM assessments WHERE id = CAST(:aid AS uuid)"),
        {"aid": str(assessment_id)},
    )
    assert stored.scalar_one() == "ollama"

    # Reading it clears it, so a retry does not inherit a stale override.
    assert await orchestrator.pop_provider_override(assessment_id) == "ollama"
    again = await session.execute(
        text("SELECT provider_override FROM assessments WHERE id = CAST(:aid AS uuid)"),
        {"aid": str(assessment_id)},
    )
    assert again.scalar_one() is None
