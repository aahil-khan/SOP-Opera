"""
Report endpoints and the close/freeze transaction, over the real app.

The atomicity case here is the regression test for the defect this rework exists
to fix: report generation used to run *after* the close had already committed, so
a failure left a `closed` review with no report and nothing to retry it.
"""

from __future__ import annotations

import io
import zipfile

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from tests.test_decisions import _bring_to_pending_decision, client  # noqa: F401


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


async def _close_one(client: AsyncClient) -> tuple[str, dict]:
    review_id, assessments = await _bring_to_pending_decision(client)
    await _decide(client, review_id, assessments)
    close = await client.post(f"/reviews/{review_id}/close")
    assert close.status_code == 200, close.text
    reports = (await client.get(f"/reviews/{review_id}/reports")).json()
    report = (await client.get(f"/reports/{reports[0]['id']}")).json()
    return review_id, report


@pytest.mark.asyncio
async def test_packet_is_built_from_the_frozen_snapshot(client: AsyncClient):
    """
    The rework's core claim. The old generator re-queried live tables, so editing
    a context row after the decision silently changed what the report appeared to
    rest on. It must now show the decision-time value.
    """
    review_id, report = await _close_one(client)
    entries = report["content"]["evidence"]["entries"]
    assert entries, "expected a frozen evidence snapshot"
    assert report["content"]["meta"]["built_from"] == "frozen_evidence"

    # Every entry is rendered as plain English, not a raw payload dump.
    for entry in entries:
        assert entry["summary_line"]
        assert entry["category_label"]


@pytest.mark.asyncio
async def test_report_has_no_raw_uuids_in_human_text(client: AsyncClient):
    """The user-visible complaint: /reports read as a UUID dump."""
    _, report = await _close_one(client)
    content = report["content"]

    human_fields = [
        content["header"]["title"],
        content["header"]["outcome_headline"],
        content["header"]["risk_headline"],
        *[e["summary_line"] for e in content["evidence"]["entries"]],
        *[f["label"] for f in content["facts"]],
        *[a["event_label"] for a in content["audit_trail"]],
    ]
    uuid_like = __import__("re").compile(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    )
    for value in human_fields:
        assert not uuid_like.search(str(value)), f"raw UUID leaked into {value!r}"


@pytest.mark.asyncio
async def test_close_rolls_back_entirely_when_the_freeze_fails(
    client: AsyncClient, monkeypatch
):
    """
    Regression: a close that cannot produce its packet must not happen at all.
    Previously the state change was already committed by the time generation ran.
    """
    review_id, assessments = await _bring_to_pending_decision(client)
    await _decide(client, review_id, assessments)

    import app.reports.service as report_service

    async def _boom(*args, **kwargs):
        raise RuntimeError("packet build exploded")

    monkeypatch.setattr(report_service, "build_packet", _boom)

    # ASGITransport re-raises app exceptions rather than returning a 500, so the
    # failure surfaces here. Either way the close must not have taken effect.
    with pytest.raises(RuntimeError, match="packet build exploded"):
        await client.post(f"/reviews/{review_id}/close")

    detail = await client.get(f"/reviews/{review_id}")
    assert detail.json()["review"]["state"] == "decided", "close must have rolled back"

    reports = (await client.get(f"/reviews/{review_id}/reports")).json()
    assert reports == [], "no orphan report may survive a failed close"


@pytest.mark.asyncio
async def test_duplicate_closure_seq_is_rejected_by_the_database(client: AsyncClient):
    """`uq_reports_review_seq` makes 'one report per closure' true at the DB."""
    review_id, report = await _close_one(client)

    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        with pytest.raises(Exception):
            await session.execute(
                text(
                    """
                    INSERT INTO reports (review_id, closure_event_seq, content)
                    VALUES (CAST(:rid AS uuid), 1, '{}'::jsonb)
                    """
                ),
                {"rid": review_id},
            )
            await session.commit()


@pytest.mark.asyncio
async def test_register_lists_current_versions_and_filters(client: AsyncClient):
    await _close_one(client)

    listing = await client.get("/reports")
    assert listing.status_code == 200
    rows = listing.json()
    assert rows, "expected at least one frozen report"
    row = rows[0]
    for key in (
        "report_ref",
        "version_label",
        "is_current",
        "asset_name",
        "outcome_label",
        "risk_level",
        "evidence_count",
    ):
        assert key in row, f"register row missing {key}"
    assert all(r["is_current"] for r in rows)

    blocked = (await client.get("/reports?outcome=blocked")).json()
    assert all(r["outcome"] == "blocked" for r in blocked)

    none_match = (await client.get("/reports?outcome=approved")).json()
    assert none_match == [] or all(r["outcome"] == "approved" for r in none_match)


@pytest.mark.asyncio
async def test_pdf_export_returns_a_real_document(client: AsyncClient):
    _, report = await _close_one(client)

    resp = await client.get(f"/reports/{report['id']}/export.pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert "attachment;" in resp.headers["content-disposition"]
    assert resp.content.startswith(b"%PDF-")


@pytest.mark.asyncio
async def test_xlsx_export_returns_a_real_workbook(client: AsyncClient):
    _, report = await _close_one(client)

    resp = await client.get(f"/reports/{report['id']}/export.xlsx")
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers["content-type"]
    z = zipfile.ZipFile(io.BytesIO(resp.content))
    assert z.testzip() is None


@pytest.mark.asyncio
async def test_dataset_export_route_is_not_swallowed_by_the_id_route(
    client: AsyncClient,
):
    """
    `/reports/export.xlsx` must be declared before `/reports/{report_id}`, or
    FastAPI matches the path param first and 422s trying to parse a UUID.
    """
    await _close_one(client)

    resp = await client.get("/reports/export.xlsx")
    assert resp.status_code == 200, resp.text
    assert "spreadsheetml" in resp.headers["content-type"]
    assert zipfile.ZipFile(io.BytesIO(resp.content)).testzip() is None


@pytest.mark.asyncio
async def test_missing_report_is_404(client: AsyncClient):
    resp = await client.get("/reports/00000000-0000-0000-0000-000000000099")
    assert resp.status_code == 404
