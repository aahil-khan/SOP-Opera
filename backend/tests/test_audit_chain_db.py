"""Audit chain end-to-end against Postgres, including the tamper demo."""

from __future__ import annotations

from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.audit.service import record_audit, verify_audit_chain
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool


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
    async with SessionLocal() as s:
        yield s
    await close_vector_pool()
    await engine.dispose()


async def _append(session, event_type: str, entity_id):
    return await record_audit(
        session,
        entity_type="review",
        entity_id=entity_id,
        event_type=event_type,
        actor="supervisor-1",
        payload={"note": event_type},
    )


@pytest.mark.asyncio
async def test_appended_entries_form_a_verifiable_chain(session):
    entity_id = uuid4()
    for event in ("review.opened", "review.assessing", "review.decided"):
        await _append(session, event, entity_id)
    await session.commit()

    verification = await verify_audit_chain(session)
    assert verification.intact, verification.as_dict()
    assert verification.entries_checked >= 3


@pytest.mark.asyncio
async def test_entries_are_linked_to_their_predecessor(session):
    entity_id = uuid4()
    await _append(session, "review.opened", entity_id)
    await _append(session, "review.decided", entity_id)
    await session.commit()

    rows = (
        await session.execute(
            text(
                """
                SELECT prev_hash, entry_hash FROM audit_entries
                WHERE entity_id = CAST(:eid AS uuid)
                ORDER BY seq ASC
                """
            ),
            {"eid": str(entity_id)},
        )
    ).fetchall()
    assert len(rows) == 2
    assert all(r.entry_hash for r in rows)
    # Second entry's prev_hash is the first entry's hash.
    assert rows[1].prev_hash == rows[0].entry_hash


@pytest.mark.asyncio
async def test_tampering_with_a_stored_row_is_detected(session):
    """The demo: alter a committed audit row by hand, chain verification fails."""
    entity_id = uuid4()
    await _append(session, "review.opened", entity_id)
    target = await _append(session, "decision.submitted", entity_id)
    await _append(session, "review.closed", entity_id)
    await session.commit()

    assert (await verify_audit_chain(session)).intact

    # Rewrite history: make a blocking decision look like an approval.
    await session.execute(
        text(
            """
            UPDATE audit_entries
            SET payload = '{"note": "decision.approved"}'::jsonb
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": str(target)},
    )
    await session.commit()

    verification = await verify_audit_chain(session)
    assert not verification.intact
    assert any(b.reason == "content_altered" for b in verification.breaks)
    assert str(target) in {b.entry_id for b in verification.breaks}


@pytest.mark.asyncio
async def test_deleting_a_row_is_detected(session):
    entity_id = uuid4()
    await _append(session, "review.opened", entity_id)
    target = await _append(session, "review.assessing", entity_id)
    await _append(session, "review.closed", entity_id)
    await session.commit()

    await session.execute(
        text("DELETE FROM audit_entries WHERE id = CAST(:id AS uuid)"),
        {"id": str(target)},
    )
    await session.commit()

    verification = await verify_audit_chain(session)
    assert not verification.intact
    assert any(b.reason == "broken_link" for b in verification.breaks)
