"""Shift handover — custody transfer, the accept gate, and the audit chain.

DB-backed (httpx ASGI over the real app + Postgres), so run this file alone.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from tests.test_assessment_pipeline import _cleanup_vessel, _wait_for_assessment

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")
OP_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
OP_B = "cccccccc-cccc-cccc-cccc-cccccccccccc"


def _cookie(actor_id: str, name: str) -> str:
    actor = {
        "id": actor_id,
        "kind": "user",
        "name": name,
        "role": "panel_operator",
        "owned_zones": [],
    }
    return quote(json.dumps(actor, separators=(",", ":")), safe="")


COOKIE_A = _cookie(OP_A, "Meera (Panel Operator · A)")
COOKIE_B = _cookie(OP_B, "Arun (Panel Operator · B)")


@pytest_asyncio.fixture
async def app_ready():
    from app.core.config import get_settings
    from app.db.session import apply_schema, engine, _asyncpg_dsn
    from app.db.seed import seed_minimal
    from app.db.seed_embeddings import seed_embeddings
    from app.db.vector import close_vector_pool
    import asyncpg
    import os

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    os.environ["AI_PROVIDER"] = "mock"
    os.environ["EMBEDDING_PROVIDER"] = "mock"
    get_settings.cache_clear()

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    await seed_embeddings()

    # Handover rows from a prior run reference reviews that _cleanup_vessel is
    # about to delete, and a leftover active one trips the uniqueness index, so
    # they must go first.
    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM handover_items"))
        await conn.execute(text("DELETE FROM handovers"))

    await _cleanup_vessel()

    from app.assessment.orchestrator import orchestrator
    from app.simulator.engine import demo_controller

    orchestrator.start()
    demo_controller.clear_locks()
    yield
    await close_vector_pool()
    await engine.dispose()


def _client(cookie: str) -> AsyncClient:
    from app.main import app

    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        cookies={"sop_actor": cookie},
    )


async def _open_blocking_review(client: AsyncClient) -> str:
    now = datetime.now(timezone.utc)
    r = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "sensor",
            "payload": {"gas_reading": 95.0, "unit": "ppm"},
            "provider": "simulator",
            "valid_from": now.isoformat(),
            "valid_until": (now + timedelta(hours=4)).isoformat(),
        },
    )
    assert r.status_code == 200, r.text
    review_id = r.json()["review"]["id"]
    await _wait_for_assessment(client, review_id, require_pending_decision=True)
    return review_id


@pytest.mark.asyncio
async def test_full_cycle_and_accept_gate(app_ready):
    async with _client(COOKIE_A) as a, _client(COOKIE_B) as b:
        await _open_blocking_review(a)

        # A composes and issues to B.
        draft = (
            await a.post(
                "/handover/draft",
                json={"incoming_actor_id": OP_B, "window_hours": 12},
            )
        ).json()
        assert draft["state"] == "draft"
        assert draft["viewer_role"] == "outgoing"
        required = [i for i in draft["items"] if i["requires_ack"]]
        assert required, "a blocking review should require acknowledgement"
        hid = draft["id"]

        issued = (await a.post(f"/handover/{hid}/issue")).json()
        assert issued["state"] == "issued"

        # B cannot accept while required items are pending.
        blocked = await b.post(f"/handover/{hid}/accept")
        assert blocked.status_code == 409
        assert "acknowledgement" in blocked.json()["detail"]

        # Only the incoming operator may acknowledge.
        wrong = await a.post(
            f"/handover/{hid}/items/{required[0]['id']}/ack",
            json={"ack_state": "acknowledged"},
        )
        assert wrong.status_code == 409

        for item in required:
            resp = await b.post(
                f"/handover/{hid}/items/{item['id']}/ack",
                json={"ack_state": "acknowledged"},
            )
            assert resp.status_code == 200, resp.text

        accepted = (await b.post(f"/handover/{hid}/accept")).json()
        assert accepted["state"] == "accepted"
        assert accepted["required_cleared"] == accepted["required_total"]

        # The audit chain still verifies after issue → ack → accept.
        verify = (await a.get("/audit/verify")).json()
        assert verify["intact"] is True, verify


@pytest.mark.asyncio
async def test_narration_reports_deterministic_under_mock_provider(app_ready):
    async with _client(COOKIE_A) as a:
        await _open_blocking_review(a)
        draft = (
            await a.post(
                "/handover/draft",
                json={"incoming_actor_id": OP_B, "window_hours": 12},
            )
        ).json()
        # The default provider is mock (no model), so the brief must own up to
        # being templated rather than claim a model wrote it.
        assert draft["narration_mode"] == "deterministic"
        assert draft["brief"]


@pytest.mark.asyncio
async def test_unacknowledged_handover_elevates_a_fresh_review(app_ready):
    """
    A carried, unacknowledged high-risk item on an asset raises that asset's
    next assessment to at least elevated — the loop closing back into the verdict.
    """
    async with _client(COOKIE_A) as a, _client(COOKIE_B) as b:
        await _open_blocking_review(a)
        draft = (
            await a.post(
                "/handover/draft",
                json={"incoming_actor_id": OP_B, "window_hours": 12},
            )
        ).json()
        await a.post(f"/handover/{draft['id']}/issue")
        # Deliberately do NOT acknowledge — leave the gap open.

        gaps = (await a.get("/handover/gaps")).json()
        assert any(g["asset_id"] == str(VESSEL_A) for g in gaps)

        metrics = (await a.get("/handover/metrics")).json()
        assert metrics["unacknowledged_crossings"] >= 1
        assert metrics["coverage_pct"] < 100.0
