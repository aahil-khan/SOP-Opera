"""POST /reviews/{id}/close — generates a report on decided → closed."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.test_decisions import _bring_to_pending_decision, client  # noqa: F401

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


async def _decide(client: AsyncClient, review_id: str, assessments: list[dict]) -> None:
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]
    resp = await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "blocked",
            "recommendation_dispositions": {rec_id: "accepted"},
            "conditions": None,
        },
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_close_only_from_decided(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)

    # Still pending_decision — close must 409
    bad = await client.post(f"/reviews/{review_id}/close")
    assert bad.status_code == 409

    await _decide(client, review_id, assessments)
    detail = await client.get(f"/reviews/{review_id}")
    assert detail.json()["review"]["state"] == "decided"

    ok = await client.post(f"/reviews/{review_id}/close")
    assert ok.status_code == 200, ok.text
    assert ok.json()["state"] == "closed"

    detail2 = await client.get(f"/reviews/{review_id}")
    assert detail2.json()["review"]["state"] == "closed"


@pytest.mark.asyncio
async def test_close_generates_one_report_and_increments_seq(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    await _decide(client, review_id, assessments)

    close1 = await client.post(f"/reviews/{review_id}/close")
    assert close1.status_code == 200, close1.text

    # /reviews/{id}/reports lists version *summaries*; the packet itself is on
    # GET /reports/{id}.
    reports = await client.get(f"/reviews/{review_id}/reports")
    assert reports.status_code == 200
    body = reports.json()
    assert len(body) == 1
    assert body[0]["closure_event_seq"] == 1
    assert body[0]["version_label"] == "v1"
    assert body[0]["is_current"] is True
    assert body[0]["outcome"] == "blocked"

    v1_id = body[0]["id"]
    v1 = (await client.get(f"/reports/{v1_id}")).json()
    assert v1["packet_version"] == 2
    content = v1["content"]
    assert content["header"]["title"]
    assert content["decision"]["outcome"] == "blocked"
    assert content["assessment"]["risk_level"]
    # The whole point of the rework: built from the decision-time snapshot.
    assert content["meta"]["built_from"] == "frozen_evidence"
    assert content["evidence"]["source"] == "frozen"
    # And the freeze is verifiable.
    assert v1["integrity"]["content_hash_status"] == "match"
    v1_hash = v1["content_hash"]
    assert v1_hash

    # Reopen → reassess → decide → close again should bump seq
    reopen = await client.post(
        f"/reviews/{review_id}/reopen", json={"reason": "retest"}
    )
    assert reopen.status_code == 200, reopen.text

    from tests.test_assessment_pipeline import _wait_for_assessment

    assessments2 = await _wait_for_assessment(
        client, review_id, require_pending_decision=True, min_version=2
    )
    await _decide(client, review_id, assessments2)
    close2 = await client.post(f"/reviews/{review_id}/close")
    assert close2.status_code == 200, close2.text

    reports2 = (await client.get(f"/reviews/{review_id}/reports")).json()
    assert len(reports2) == 2
    assert {r["closure_event_seq"] for r in reports2} == {1, 2}

    by_seq = {r["closure_event_seq"]: r for r in reports2}
    assert by_seq[2]["is_current"] is True
    assert by_seq[1]["is_current"] is False

    # v1 must be byte-identical to what it was before the reopen. Reopening a
    # closed review mints a new version; it never rewrites the frozen one.
    v1_again = (await client.get(f"/reports/{v1_id}")).json()
    assert v1_again["content_hash"] == v1_hash
    assert v1_again["integrity"]["content_hash_status"] == "match"
    assert v1_again["is_current"] is False
    assert v1_again["superseded_by_report_id"] == by_seq[2]["id"]

    v2 = (await client.get(f"/reports/{by_seq[2]['id']}")).json()
    assert v2["supersedes_report_id"] == v1_id
    assert len(v2["versions"]) == 2


@pytest.mark.asyncio
async def test_close_missing_review_404(client: AsyncClient):
    resp = await client.post(
        "/reviews/00000000-0000-0000-0000-000000000099/close"
    )
    assert resp.status_code == 404
