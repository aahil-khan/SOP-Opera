from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


@pytest_asyncio.fixture
async def client():
    from app.db.session import apply_schema, _asyncpg_dsn, engine
    from app.db.vector import close_vector_pool
    from app.core.config import get_settings
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

    conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
    try:
        review_ids = [
            r["id"]
            for r in await conn.fetch(
                "SELECT id FROM reviews WHERE asset_id = $1", VESSEL_A
            )
        ]
        if review_ids:
            assessment_ids = [
                a["id"]
                for a in await conn.fetch(
                    "SELECT id FROM assessments WHERE review_id = ANY($1::uuid[])",
                    review_ids,
                )
            ]
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
                "DELETE FROM evidence WHERE review_id = ANY($1::uuid[])", review_ids
            )
            await conn.execute(
                "DELETE FROM review_tasks WHERE review_id = ANY($1::uuid[])",
                review_ids,
            )
            await conn.execute(
                "DELETE FROM review_comments WHERE review_id = ANY($1::uuid[])",
                review_ids,
            )
            await conn.execute(
                "DELETE FROM decisions WHERE review_id = ANY($1::uuid[])", review_ids
            )
            if assessment_ids:
                await conn.execute(
                    "DELETE FROM assessments WHERE id = ANY($1::uuid[])",
                    assessment_ids,
                )
            await conn.execute(
                "DELETE FROM reports WHERE review_id = ANY($1::uuid[])", review_ids
            )
            await conn.execute(
                "DELETE FROM notifications WHERE review_id = ANY($1::uuid[])",
                review_ids,
            )
            await conn.execute(
                "DELETE FROM reviews WHERE id = ANY($1::uuid[])", review_ids
            )
        await conn.execute("DELETE FROM audit_entries")
        await conn.execute(
            "DELETE FROM derived_facts WHERE asset_id = $1", VESSEL_A
        )
        await conn.execute(
            "DELETE FROM context_entries WHERE asset_id = $1", VESSEL_A
        )
    finally:
        await conn.close()

    from app.main import app
    from app.assessment.orchestrator import orchestrator

    orchestrator.start()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    orchestrator.stop()
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_compound_risk_context_flow(client: AsyncClient):
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
    body1 = r1.json()
    assert body1["review"] is not None
    assert body1["review"]["state"] in ("assessing", "pending_decision")
    types1 = {f["fact_type"] for f in body1["derived_facts"]}
    assert "elevated_gas" in types1
    review_id = body1["review"]["id"]

    r2 = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "worker_location",
            "payload": {
                "worker_id": "55555555-5555-5555-5555-555555555551",
                "zone": "hazardous",
            },
            "provider": "simulator",
            "valid_from": frm,
            "valid_until": until,
            "confidence": 0.95,
        },
    )
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert body2["context"]["payload"]["worker_name"] == "Asha Rao"
    types2 = {f["fact_type"] for f in body2["derived_facts"]}
    assert "elevated_gas" in types2
    assert "zone_occupied" in types2
    assert body2["review"]["id"] == review_id
    assert body2["review"]["state"] in ("assessing", "pending_decision")

    r3 = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "permit",
            "payload": {
                "permit_id": "p-1",
                "status": "active",
                "work_type": "hot_work",
            },
            "provider": "simulator",
            "valid_from": frm,
            "valid_until": until,
            "confidence": 1.0,
        },
    )
    assert r3.status_code == 200, r3.text
    types3 = {f["fact_type"] for f in r3.json()["derived_facts"]}
    assert "elevated_gas" in types3 and "zone_occupied" in types3

    r4 = await client.post(
        "/context",
        json={
            "asset_id": str(VESSEL_A),
            "category": "permit",
            "payload": {
                "permit_id": "p-2",
                "status": "active",
                "work_type": "cold_work",
            },
            "provider": "simulator",
            "valid_from": frm,
            "valid_until": until,
            "confidence": 1.0,
        },
    )
    assert r4.status_code == 200, r4.text
    types4 = {f["fact_type"] for f in r4.json()["derived_facts"]}
    assert {"elevated_gas", "zone_occupied", "permit_conflict"} <= types4

    detail = await client.get(f"/reviews/{review_id}")
    assert detail.status_code == 200, detail.text
    d = detail.json()
    assert d["review"]["state"] in ("assessing", "pending_decision")
    detail_types = {f["fact_type"] for f in d["derived_facts"]}
    assert {"elevated_gas", "zone_occupied", "permit_conflict"} <= detail_types
    assert len(d["context"]) >= 3

    context_resp = await client.get(f"/assets/{VESSEL_A}/context")
    assert context_resp.status_code == 200, context_resp.text
    worker_ctx = [
        c for c in context_resp.json() if c["category"] == "worker_location"
    ]
    assert worker_ctx
    assert worker_ctx[0]["payload"]["worker_name"] == "Asha Rao"
