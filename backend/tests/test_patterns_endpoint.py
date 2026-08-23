"""GET /api/patterns, and the human verdict on a mined pattern (W13)."""

from __future__ import annotations

import json
from urllib.parse import quote

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text


async def _seeded_actor_cookie() -> str:
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        row = (await s.execute(text("SELECT id, name, role FROM users LIMIT 1"))).first()
    m = row._mapping
    actor = {
        "id": str(m["id"]),
        "kind": "user",
        "name": m["name"],
        "role": m["role"],
        "owned_zones": [],
    }
    return quote(json.dumps(actor, separators=(",", ":")), safe="")


@pytest_asyncio.fixture
async def client():
    import os

    import asyncpg

    from app.core.config import get_settings
    from app.db.seed import seed_minimal
    from app.db.session import _asyncpg_dsn, apply_schema, engine
    from app.db.vector import close_vector_pool

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

    # Verdicts persist by design — they are a human record, and nothing in the
    # app deletes them. That makes them leak between runs of this file: the
    # second run finds the pattern already ratified and the "candidate" it
    # expected is gone. Cleared per test so each starts from no human verdict.
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        await s.execute(text("DELETE FROM pattern_verdicts"))
        await s.commit()

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        cookies={"sop_actor": await _seeded_actor_cookie()},
    ) as ac:
        yield ac
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_patterns_reports_what_it_searched(client):
    """
    The scope block is not decoration: a ratio without its denominator and its
    bar is a claim the reader cannot check.
    """
    res = await client.get("/api/patterns?months=12")
    assert res.status_code == 200
    body = res.json()

    scope = body["scope"]
    assert scope["window_months"] == 12
    assert scope["min_support"] >= 1
    assert scope["min_ratio"] > 1.0
    # Stricter than the usual 0.01 on purpose — see miner.ALPHA.
    assert scope["alpha"] <= 0.001
    assert isinstance(body["patterns"], list)
    assert isinstance(body["corpus_is_seeded"], bool)


@pytest.mark.asyncio
async def test_every_reported_pattern_says_why_no_rule_covers_it(client):
    """
    The per-row justification is the feature's whole argument. A pattern with
    neither a covering clause nor a reason would be an unexplained assertion
    about plant safety.
    """
    body = (await client.get("/api/patterns?months=24")).json()
    for p in body["patterns"]:
        assert p["covered_by"] or p["why_no_rule"], p["key"]
        assert p["claim"].strip(), p["key"]
        assert p["trials"] >= body["scope"]["min_support"], p["key"]


@pytest.mark.asyncio
async def test_verdict_on_an_unknown_pattern_is_refused(client):
    """
    409, not 404 or a silent insert. A key the miner does not currently report
    means the corpus moved under the page — recording a verdict on it would
    attach a human signature to something nobody can now see.
    """
    res = await client.post("/api/patterns/recurrence:not_a_real_fact/ratify")
    assert res.status_code == 409
    assert "not in the current mined set" in res.json()["detail"]


@pytest.fixture
def one_candidate(monkeypatch):
    """
    Put a single, unambiguous pattern in front of the endpoint.

    Patched at the repository seam rather than by inserting rows: what these
    tests are about is the verdict path — actor, persistence, audit chain — and
    whether a corpus happens to contain a candidate is the miner's business,
    covered in test_pattern_miner.py. Without this the tests skip, and a skip
    reads as a pass while exercising nothing.
    """
    from datetime import datetime, timedelta, timezone

    from app.patterns import repository as repo
    from app.patterns.miner import Event

    t0 = datetime(2026, 1, 1, 6, 0, tzinfo=timezone.utc)
    events = []
    for i in range(60):
        persistent = i % 3 == 0
        events.append(
            Event(
                review_id=f"{i:08d}-0000-0000-0000-000000000000",
                asset_id="pump" if persistent else f"other{i % 6}",
                asset_name="Pump House" if persistent else "Other",
                at=t0 + timedelta(hours=i * 8),
                facts=("equipment_vibration_anomaly",) if persistent else (),
                verdict="elevated" if persistent else "nominal",
            )
        )

    async def fake_load_events(session, months):
        return events

    monkeypatch.setattr(repo, "load_events", fake_load_events)
    return "recurrence:equipment_vibration_anomaly"


@pytest.mark.asyncio
async def test_ratifying_records_the_actor_and_appends_to_the_audit_chain(
    client, one_candidate
):
    """
    Ratification is a human act on the record, held to the same standard as
    every other decision in the product.
    """
    body = (await client.get("/api/patterns?months=24")).json()
    open_ones = [
        p for p in body["patterns"] if p["state"] == "candidate" and not p["covered_by"]
    ]
    assert open_ones, "fixture should have produced a candidate"

    key = one_candidate
    assert any(p["key"] == key for p in open_ones)
    before = (await client.get("/audit/verify")).json()

    res = await client.post(f"/api/patterns/{key}/ratify", json={"note": "seen it too"})
    assert res.status_code == 200
    got = res.json()
    assert got["state"] == "ratified"
    assert got["decided_by"]
    assert got["decided_at"]
    assert got["note"] == "seen it too"

    # Survives a re-read: the verdict is stored, not just echoed back.
    again = (await client.get("/api/patterns?months=24")).json()
    match = next(p for p in again["patterns"] if p["key"] == key)
    assert match["state"] == "ratified"

    after = (await client.get("/audit/verify")).json()
    assert after["breaks"] == [], "ratifying forked the audit chain"
    assert after["entries_checked"] > before["entries_checked"]


@pytest.mark.asyncio
async def test_a_verdict_can_be_changed(client, one_candidate):
    """A supervisor changing their mind is normal; the chain keeps both acts."""
    key = one_candidate
    assert (await client.post(f"/api/patterns/{key}/ratify")).status_code == 200
    res = await client.post(f"/api/patterns/{key}/dismiss")
    assert res.status_code == 200
    assert res.json()["state"] == "dismissed"

    verify = (await client.get("/audit/verify")).json()
    assert verify["breaks"] == []
