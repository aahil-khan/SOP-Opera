"""GET /reports and GET /reports/{id}."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.test_decisions import VESSEL_A, _bring_to_pending_decision, client  # noqa: F401
from tests.test_review_closure import _decide

OTHER_ASSET = UUID("22222222-2222-2222-2222-222222222222")


@pytest.mark.asyncio
async def test_reports_list_and_detail(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    await _decide(client, review_id, assessments)
    close = await client.post(f"/reviews/{review_id}/close")
    assert close.status_code == 200

    listing = await client.get("/reports")
    assert listing.status_code == 200
    items = listing.json()
    assert len(items) >= 1
    match = next(r for r in items if r["review_id"] == review_id)
    assert match["outcome"] == "blocked"
    assert match["title"]
    assert match["asset_name"]
    assert match["summary_line"]
    assert match["outcome_headline"]

    detail = await client.get(f"/reports/{match['id']}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["id"] == match["id"]
    assert body["content"]["decision"]["outcome"] == "blocked"
    assert body["content"]["evidence"] is not None


@pytest.mark.asyncio
async def test_reports_list_filter_by_asset_id(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    await _decide(client, review_id, assessments)
    close = await client.post(f"/reviews/{review_id}/close")
    assert close.status_code == 200

    for_asset = await client.get("/reports", params={"asset_id": str(VESSEL_A)})
    assert for_asset.status_code == 200
    items = for_asset.json()
    assert len(items) >= 1
    assert all(r["asset_name"] for r in items)
    assert any(r["review_id"] == review_id for r in items)

    other = await client.get("/reports", params={"asset_id": str(OTHER_ASSET)})
    assert other.status_code == 200
    assert all(r["review_id"] != review_id for r in other.json())


@pytest.mark.asyncio
async def test_report_detail_404(client: AsyncClient):
    resp = await client.get("/reports/00000000-0000-0000-0000-000000000099")
    assert resp.status_code == 404
