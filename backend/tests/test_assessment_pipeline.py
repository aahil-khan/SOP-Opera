from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


async def _cleanup_vessel() -> None:
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn
    import asyncpg

    conn = await asyncpg.connect(_asyncpg_dsn(get_settings().database_url))
    try:
        review_ids = await conn.fetch(
            "SELECT id FROM reviews WHERE asset_id = $1", VESSEL_A
        )
        rids = [r["id"] for r in review_ids]
        if rids:
            aids = await conn.fetch(
                "SELECT id FROM assessments WHERE review_id = ANY($1::uuid[])", rids
            )
            assessment_ids = [a["id"] for a in aids]
            await conn.execute(
                "DELETE FROM evidence WHERE review_id = ANY($1::uuid[])", rids
            )
            await conn.execute(
                "DELETE FROM review_tasks WHERE review_id = ANY($1::uuid[])", rids
            )
            await conn.execute(
                "DELETE FROM review_comments WHERE review_id = ANY($1::uuid[])", rids
            )
            await conn.execute(
                "DELETE FROM decisions WHERE review_id = ANY($1::uuid[])", rids
            )
            await conn.execute(
                "DELETE FROM reports WHERE review_id = ANY($1::uuid[])", rids
            )
            await conn.execute(
                "DELETE FROM notifications WHERE review_id = ANY($1::uuid[])", rids
            )
            if assessment_ids:
                await conn.execute(
                    "DELETE FROM recommendations WHERE assessment_id = ANY($1::uuid[])",
                    assessment_ids,
                )
                await conn.execute(
                    "DELETE FROM assessment_metadata WHERE assessment_id = ANY($1::uuid[])",
                    assessment_ids,
                )
                await conn.execute(
                    "DELETE FROM assessments WHERE id = ANY($1::uuid[])",
                    assessment_ids,
                )
            await conn.execute("DELETE FROM reviews WHERE id = ANY($1::uuid[])", rids)
        await conn.execute("DELETE FROM derived_facts WHERE asset_id = $1", VESSEL_A)
        await conn.execute("DELETE FROM context_entries WHERE asset_id = $1", VESSEL_A)
        await conn.execute("DELETE FROM audit_entries")
    finally:
        await conn.close()


@pytest_asyncio.fixture
async def client():
    from app.core.config import get_settings
    from app.db.session import apply_schema, _asyncpg_dsn
    import asyncpg

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    # Force mock AI for deterministic integration tests
    get_settings.cache_clear()
    import os

    os.environ["AI_PROVIDER"] = "mock"
    os.environ["EMBEDDING_PROVIDER"] = "mock"
    get_settings.cache_clear()

    from app.db.session import apply_schema, engine
    from app.db.vector import close_vector_pool

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    from app.db.seed import seed_minimal
    from app.db.seed_embeddings import seed_embeddings

    await seed_minimal()
    await seed_embeddings()
    await _cleanup_vessel()

    from app.main import app
    from app.assessment.orchestrator import orchestrator

    # Ensure worker is running even if lifespan quirks
    orchestrator.start()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_vector_pool()
    await engine.dispose()


async def _wait_for_assessment(
    client: AsyncClient,
    review_id: str,
    *,
    timeout: float = 10.0,
    min_version: int = 1,
    require_pending_decision: bool = False,
) -> list[dict]:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/reviews/{review_id}/assessments")
        assert resp.status_code == 200, resp.text
        rows = resp.json()
        done = [
            r
            for r in rows
            if r["status"] in ("complete", "failed") and r["version"] >= min_version
        ]
        in_flight = any(r["status"] in ("pending", "generating") for r in rows)
        if done and not in_flight:
            if require_pending_decision:
                detail = await client.get(f"/reviews/{review_id}")
                if detail.json()["review"]["state"] == "pending_decision":
                    return rows
            else:
                return rows
        await asyncio.sleep(0.15)
    raise AssertionError(
        f"timed out waiting for assessment version>={min_version} completion"
    )


@pytest.mark.asyncio
async def test_assessment_pipeline_compound_risk(client: AsyncClient):
    now = datetime.now(timezone.utc)
    until = (now + timedelta(hours=4)).isoformat()
    frm = now.isoformat()

    r1 = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "sensor",
            "payload": {"gas_reading": 25.5, "unit": "ppm"},
            "provider": "simulator",
            "valid_from": frm,
            "valid_until": until,
            "confidence": 0.98,
        },
    )
    assert r1.status_code == 200, r1.text
    review_id = r1.json()["review"]["id"]
    assert r1.json()["review"]["state"] in ("assessing", "pending_decision")

    # Wait for first pass (while assessing, additional context won't re-trigger).
    first = await _wait_for_assessment(client, review_id, min_version=1)
    v1 = max(a["version"] for a in first)

    # Now in pending_decision — further fact changes re-trigger assessment.
    for payload in (
        {
            "category": "worker_location",
            "payload": {
                "worker_id": "55555555-5555-5555-5555-555555555551",
                "zone": "hazardous",
            },
            "confidence": 0.95,
        },
        {
            "category": "permit",
            "payload": {
                "permit_id": "p-1",
                "status": "active",
                "work_type": "hot_work",
            },
            "confidence": 1.0,
        },
        {
            "category": "permit",
            "payload": {
                "permit_id": "p-2",
                "status": "active",
                "work_type": "cold_work",
            },
            "confidence": 1.0,
        },
    ):
        resp = await client.post(
            "/context",
            json={
                "asset_id": str(VESSEL_A),
                "provider": "simulator",
                "valid_from": frm,
                "valid_until": until,
                **payload,
            },
        )
        assert resp.status_code == 200, resp.text

    assessments = await _wait_for_assessment(
        client,
        review_id,
        timeout=15.0,
        min_version=v1 + 1,
        require_pending_decision=True,
    )
    complete = [
        a
        for a in assessments
        if a["status"] == "complete" and a["version"] >= v1 + 1
    ]
    assert complete, assessments
    latest = complete[0]
    assert latest["assessment_type"] == "ai"
    assert latest["risk_level"] in ("elevated", "blocking")
    assert latest["recommendations"]
    assert latest["metadata"] is not None
    assert latest["metadata"]["retrieval_mode"] in ("rag", "deterministic", "skipped")
    assert latest["metadata"]["provider"] == "mock"
    assert "retrieved_references" in latest
    assert "reasoning_factors" in latest
    assert latest["reasoning_factors"], "expected structured why factors"
    assert all(
        f.get("headline") and f.get("detail") for f in latest["reasoning_factors"]
    )
    if latest["metadata"]["retrieval_mode"] != "skipped":
        assert latest["retrieved_references"]
        assert all("retrieval_path" in r for r in latest["retrieved_references"])
        # Enrichment should surface human-readable titles for deterministic/RAG refs
        assert any(r.get("title") or r.get("snippet") for r in latest["retrieved_references"])

    detail = await client.get(f"/reviews/{review_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["review"]["state"] == "pending_decision"
    assert body["asset"]["name"] == "Vessel A"
    assert body["area_owner"] is not None
    assert body["area_owner"]["name"] == "Asha Rao"
    # Worker location context should resolve to a display name
    worker_ctx = [c for c in body["context"] if c["category"] == "worker_location"]
    assert worker_ctx
    assert worker_ctx[0]["payload"].get("worker_name") == "Asha Rao"
    detail_types = {f["fact_type"] for f in body["derived_facts"]}
    assert {"elevated_gas", "zone_occupied", "permit_conflict"} <= detail_types
