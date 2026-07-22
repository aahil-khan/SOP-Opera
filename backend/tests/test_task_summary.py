"""HITL task summary on review detail + cancel-on-reopen."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.test_decisions import _bring_to_pending_decision, client  # noqa: F401

ASHA = UUID("55555555-5555-5555-5555-555555555551")


@pytest.mark.asyncio
async def test_task_summary_awaiting_fix_after_decision(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]

    resp = await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "blocked",
            "recommendation_dispositions": {rec_id: "accepted"},
        },
    )
    assert resp.status_code == 201, resp.text

    detail = await client.get(f"/reviews/{review_id}")
    assert detail.status_code == 200
    body = detail.json()
    summary = body["task_summary"]
    assert summary is not None
    assert summary["total"] >= 1
    assert summary["open"] >= 1
    assert summary["all_done"] is False
    tasks = body["tasks"]
    assert len(tasks) >= 1
    assert any(t["status"] == "open" for t in tasks)
    assert all(t["title"] for t in tasks)


@pytest.mark.asyncio
async def test_task_summary_all_done_when_tasks_completed(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]

    await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "blocked",
            "recommendation_dispositions": {rec_id: "accepted"},
        },
    )

    tasks_resp = await client.get(
        "/tasks",
        params={"assigned_worker_id": str(ASHA)},
    )
    assert tasks_resp.status_code == 200
    open_tasks = [
        t for t in tasks_resp.json()
        if t["review_id"] == review_id and t["status"] != "done"
    ]
    assert open_tasks

    login = await client.post("/auth/login", json={"actor_id": str(ASHA)})
    assert login.status_code == 200, login.text

    for task in open_tasks:
        if task["status"] == "open":
            ack = await client.post(f"/tasks/{task['id']}/acknowledge")
            assert ack.status_code == 200, ack.text
        done = await client.post(
            f"/tasks/{task['id']}/done",
            json={"done_note": "Fixed."},
        )
        assert done.status_code == 200, done.text

    detail = await client.get(f"/reviews/{review_id}")
    summary = detail.json()["task_summary"]
    assert summary["all_done"] is True
    assert summary["open"] == 0
    assert summary["acknowledged"] == 0
    assert summary["done"] >= 1


@pytest.mark.asyncio
async def test_reopen_from_decided_cancels_open_tasks(client: AsyncClient):
    review_id, assessments = await _bring_to_pending_decision(client)
    complete = next(a for a in assessments if a["status"] == "complete")
    rec_id = complete["recommendations"][0]["id"]

    await client.post(
        f"/reviews/{review_id}/decisions",
        json={
            "outcome": "blocked",
            "recommendation_dispositions": {rec_id: "accepted"},
        },
    )

    tasks_before = await client.get(
        "/tasks",
        params={"assigned_worker_id": str(ASHA)},
    )
    review_tasks = [
        t for t in tasks_before.json() if t["review_id"] == review_id
    ]
    assert review_tasks
    assert any(t["status"] == "open" for t in review_tasks)

    reopen = await client.post(
        f"/reviews/{review_id}/reopen",
        json={"reason": "Issue persists"},
    )
    assert reopen.status_code == 200, reopen.text
    assert reopen.json()["state"] == "assessing"

    detail = await client.get(f"/reviews/{review_id}")
    summary = detail.json()["task_summary"]
    assert summary["cancelled"] >= 1
    assert summary["open"] == 0
    assert summary["acknowledged"] == 0
