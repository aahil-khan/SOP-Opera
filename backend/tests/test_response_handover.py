"""
An automatic action still in effect is plant state the next shift inherits.

Regression guard: `item_type` is a closed Literal union in both `shared/`
mirrors, so adding a new carry-forward source without widening it would pass
every existing handover test (none of them have a response action) and then fail
at serialization the first time one exists.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text

VESSEL_A = uuid.UUID("11111111-1111-1111-1111-111111111111")


@pytest_asyncio.fixture
async def session():
    import asyncpg

    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn

    try:
        conn = await asyncpg.connect(_asyncpg_dsn(get_settings().database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    from app.db.seed import seed_minimal
    from app.db.seed_response import seed_response
    from app.db.session import SessionLocal, apply_schema, engine
    from app.db.vector import close_vector_pool

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    await seed_response()

    async with SessionLocal() as s:
        yield s

    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_active_action_carries_into_the_handover(session):
    from app.handover.composer import compose_carry_forward
    from app.response import repository as repo
    from app.response.service import evaluate_and_arm, execute_action

    owner = (await session.execute(text("SELECT id FROM users LIMIT 1"))).scalar_one()
    rid = (
        await session.execute(
            text(
                """INSERT INTO reviews (asset_id, state, owner_id, triggered_by)
                   VALUES (CAST(:a AS uuid),'assessing',CAST(:o AS uuid),'w1-handover')
                   RETURNING id"""
            ),
            {"a": str(VESSEL_A), "o": str(owner)},
        )
    ).scalar_one()
    await session.commit()

    await evaluate_and_arm(
        session, review_id=rid, asset_id=VESSEL_A,
        risk_level="blocking",
        fact_types=["elevated_gas", "incomplete_isolation", "zone_occupied"],
    )
    await session.commit()

    rows = await repo.list_actions_for_review(session, rid)
    vent = await repo.get_action(
        session, next(r for r in rows if r["action_kind"] == "ventilation_on")["id"]
    )
    await execute_action(session, vent)
    await session.commit()

    items = await compose_carry_forward(session, window_hours=12)
    response_items = [i for i in items if i["item_type"] == "response_action"]
    assert response_items, "an in-effect action must carry to the next shift"

    item = response_items[0]
    assert item["requires_ack"] is True, (
        "custody of automatic plant state must be knowingly taken"
    )
    assert "still in effect" in item["title"]


@pytest.mark.asyncio
async def test_carry_forward_item_type_is_accepted_by_the_shared_contract(session):
    """The union in shared/ must already include the new item type."""
    from shared.python.schemas import HandoverItemType
    from typing import get_args

    assert "response_action" in get_args(HandoverItemType)


@pytest.mark.asyncio
async def test_revoked_action_does_not_carry(session):
    """Only what is *still* in effect is inherited."""
    from app.handover.composer import compose_carry_forward
    from app.response import repository as repo
    from app.response.service import evaluate_and_arm, execute_action, revoke_action

    owner = (await session.execute(text("SELECT id FROM users LIMIT 1"))).scalar_one()
    rid = (
        await session.execute(
            text(
                """INSERT INTO reviews (asset_id, state, owner_id, triggered_by)
                   VALUES (CAST(:a AS uuid),'assessing',CAST(:o AS uuid),'w1-revoked')
                   RETURNING id"""
            ),
            {"a": str(VESSEL_A), "o": str(owner)},
        )
    ).scalar_one()
    await session.commit()

    await evaluate_and_arm(
        session, review_id=rid, asset_id=VESSEL_A,
        risk_level="blocking",
        fact_types=["elevated_gas", "incomplete_isolation", "zone_occupied"],
    )
    await session.commit()

    rows = await repo.list_actions_for_review(session, rid)
    for r in rows:
        if r["status"] != "armed":
            continue
        full = await repo.get_action(session, r["id"])
        await execute_action(session, full)
    await session.commit()

    for r in await repo.list_actions_for_review(session, rid):
        if r["status"] == "active" and r["tier"] > 0:
            await revoke_action(
                session, r["id"], actor="supervisor", reason="stand down"
            )
    await session.commit()

    items = await compose_carry_forward(session, window_hours=12)
    mine = [
        i
        for i in items
        if i["item_type"] == "response_action" and i["review_id"] == rid
    ]
    assert not mine, "a revoked action is not inherited by the next shift"
