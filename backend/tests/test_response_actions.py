"""
DB-backed behaviour of the Emergency Response Orchestrator (W1).

Covers the four things that would be embarrassing to get wrong on stage: tiers
firing from the verdict, Tier 3 being refused rather than absent, a re-assessment
not double-arming (or double-paging), and a revocation actually reverting the
device it drove.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text

VESSEL_A = uuid.UUID("11111111-1111-1111-1111-111111111111")  # coke-oven-battery


async def _db_or_skip():
    import asyncpg

    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn

    try:
        conn = await asyncpg.connect(_asyncpg_dsn(get_settings().database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")


@pytest_asyncio.fixture
async def session():
    """Engine disposed either side — see the note in test_webhook_ingest.py."""
    await _db_or_skip()

    from app.db.session import SessionLocal, apply_schema, engine
    from app.db.seed import seed_minimal
    from app.db.seed_response import seed_response
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


async def _new_review(session) -> uuid.UUID:
    owner = (await session.execute(text("SELECT id FROM users LIMIT 1"))).scalar_one()
    rid = (
        await session.execute(
            text(
                """INSERT INTO reviews (asset_id, state, owner_id, triggered_by)
                   VALUES (CAST(:a AS uuid), 'assessing', CAST(:o AS uuid), 'w1-test')
                   RETURNING id"""
            ),
            {"a": str(VESSEL_A), "o": str(owner)},
        )
    ).scalar_one()
    await session.commit()
    return rid


def _kinds(rows, status=None):
    return {r["action_kind"] for r in rows if status is None or r["status"] == status}


@pytest.mark.asyncio
async def test_blocking_verdict_fires_all_three_tiers(session):
    from app.response.service import evaluate_and_arm

    rid = await _new_review(session)
    rows = await evaluate_and_arm(
        session,
        review_id=rid,
        asset_id=VESSEL_A,
        risk_level="blocking",
        fact_types=["elevated_gas", "incomplete_isolation", "zone_occupied"],
    )
    await session.commit()

    tiers = {r["tier"] for r in rows}
    assert {0, 1, 2}.issubset(tiers), "blocking must fire preserve, warn and protect"
    assert "preserve_evidence" in _kinds(rows, "active")
    assert "ventilation_on" in _kinds(rows, "armed")
    assert "page_response_team" in _kinds(rows, "armed")


@pytest.mark.asyncio
async def test_nominal_with_facts_preserves_evidence_and_nothing_else(session):
    from app.response.service import evaluate_and_arm

    rid = await _new_review(session)
    rows = await evaluate_and_arm(
        session,
        review_id=rid,
        asset_id=VESSEL_A,
        risk_level="nominal",
        fact_types=["certification_expiring"],
    )
    await session.commit()

    assert {r["tier"] for r in rows} == {0}
    assert not _kinds(rows, "armed"), "a nominal verdict must arm nothing"


@pytest.mark.asyncio
async def test_tier3_is_recorded_as_refused_not_omitted(session):
    """The boundary must be visible in the data, not merely absent from it."""
    from app.response.service import evaluate_and_arm

    rid = await _new_review(session)
    rows = await evaluate_and_arm(
        session,
        review_id=rid,
        asset_id=VESSEL_A,
        risk_level="blocking",
        fact_types=["critical_gas"],
    )
    await session.commit()

    refused = [r for r in rows if r["status"] == "refused"]
    assert {"unit_shutdown", "depressurize", "evacuation_complete"} <= {
        r["action_kind"] for r in refused
    }
    for r in refused:
        assert r["refusal_reason"], "a refusal must say why"
        assert r["envelope"]["clauses"]["tier_permits_automation"] is False


@pytest.mark.asyncio
async def test_reassessment_does_not_double_arm_or_double_page(session):
    """
    A review is re-assessed whenever new context arrives. The second pass must
    not arm a second ventilation command or page the marshal twice.
    """
    from app.response.service import evaluate_and_arm
    from app.response import repository as repo

    rid = await _new_review(session)
    facts = ["elevated_gas", "incomplete_isolation", "zone_occupied"]
    await evaluate_and_arm(
        session, review_id=rid, asset_id=VESSEL_A,
        risk_level="blocking", fact_types=facts,
    )
    await session.commit()
    await evaluate_and_arm(
        session, review_id=rid, asset_id=VESSEL_A,
        risk_level="blocking", fact_types=facts,
    )
    await session.commit()

    rows = await repo.list_actions_for_review(session, rid)
    live = [r for r in rows if r["status"] in ("armed", "active", "refused")]
    kinds = [r["action_kind"] for r in live]
    assert len(kinds) == len(set(kinds)), f"duplicate live actions: {kinds}"

    tier0 = [r for r in rows if r["tier"] == 0]
    assert len(tier0) == 1, "Tier 0 must write exactly one snapshot per incident"


@pytest.mark.asyncio
async def test_execute_then_revoke_reverts_the_device(session):
    from app.response import repository as repo
    from app.response.service import evaluate_and_arm, execute_action, revoke_action

    rid = await _new_review(session)
    await evaluate_and_arm(
        session, review_id=rid, asset_id=VESSEL_A,
        risk_level="blocking",
        fact_types=["elevated_gas", "incomplete_isolation", "zone_occupied"],
    )
    await session.commit()

    rows = await repo.list_actions_for_review(session, rid)
    vent = next(r for r in rows if r["action_kind"] == "ventilation_on")
    full = await repo.get_action(session, vent["id"])
    assert full["default_state"] == "off"

    await execute_action(session, full)
    await session.commit()
    state = (
        await session.execute(
            text("SELECT state FROM response_devices WHERE id = CAST(:i AS uuid)"),
            {"i": str(vent["device_id"])},
        )
    ).scalar_one()
    assert state == "on"

    await revoke_action(
        session, vent["id"], actor="supervisor", reason="false alarm"
    )
    await session.commit()
    state = (
        await session.execute(
            text("SELECT state FROM response_devices WHERE id = CAST(:i AS uuid)"),
            {"i": str(vent["device_id"])},
        )
    ).scalar_one()
    assert state == "off", "revocation must return the device to its default state"

    after = await repo.get_action(session, vent["id"])
    assert after["status"] == "revoked"
    assert after["revoke_reason"] == "false alarm"


@pytest.mark.asyncio
async def test_abort_during_the_window_prevents_execution(session):
    from app.response import repository as repo
    from app.response.service import abort_action, evaluate_and_arm

    rid = await _new_review(session)
    await evaluate_and_arm(
        session, review_id=rid, asset_id=VESSEL_A,
        risk_level="elevated", fact_types=["elevated_gas"],
    )
    await session.commit()

    rows = await repo.list_actions_for_review(session, rid)
    armed = next(r for r in rows if r["status"] == "armed")
    assert await abort_action(session, armed["id"], actor="supervisor")
    await session.commit()

    after = await repo.get_action(session, armed["id"])
    assert after["status"] == "aborted"
    assert after["executed_at"] is None

    # Already aborted — the dispatcher must not pick it up.
    due = await repo.due_armed_actions(session)
    assert armed["id"] not in {d["id"] for d in due}


@pytest.mark.asyncio
async def test_actions_are_frozen_into_the_closure_report(session):
    """
    What the system did about an incident is part of its evidence, including
    the Tier 3 actions it refused to take.
    """
    from app.reports.packet import PACKET_VERSION, _build_response_actions
    from app.response.service import evaluate_and_arm

    assert PACKET_VERSION >= 3, "response_actions landed in packet v3"

    rid = await _new_review(session)
    await evaluate_and_arm(
        session, review_id=rid, asset_id=VESSEL_A,
        risk_level="blocking",
        fact_types=["elevated_gas", "incomplete_isolation", "zone_occupied"],
    )
    await session.commit()

    frozen = await _build_response_actions(session, rid)
    kinds = {a.action_kind for a in frozen}
    assert "ventilation_on" in kinds
    assert "unit_shutdown" in kinds, "a refusal is evidence, not noise"

    shutdown = next(a for a in frozen if a.action_kind == "unit_shutdown")
    assert shutdown.status == "refused"
    assert shutdown.refusal_reason
    assert shutdown.envelope["clauses"]["tier_permits_automation"] is False


@pytest.mark.asyncio
async def test_audit_chain_survives_a_full_response_cycle(session):
    """Every action and revocation chains; the chain must still verify."""
    from app.audit.service import verify_audit_chain
    from app.response import repository as repo
    from app.response.service import evaluate_and_arm, execute_action, revoke_action

    rid = await _new_review(session)
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
    await revoke_action(session, vent["id"], actor="supervisor", reason="stand down")
    await session.commit()

    verification = await verify_audit_chain(session)
    assert not verification.breaks, f"audit chain broken: {verification.breaks}"
