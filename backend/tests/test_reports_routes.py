"""GET /reports and GET /reports/{id}."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.test_decisions import _bring_to_pending_decision, client  # noqa: F401
from tests.test_review_closure import _decide


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

    detail = await client.get(f"/reports/{match['id']}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["id"] == match["id"]
    assert body["content"]["decision"]["outcome"] == "blocked"
    assert body["content"]["evidence"] is not None


@pytest.mark.asyncio
async def test_report_detail_404(client: AsyncClient):
    resp = await client.get("/reports/00000000-0000-0000-0000-000000000099")
    assert resp.status_code == 404
