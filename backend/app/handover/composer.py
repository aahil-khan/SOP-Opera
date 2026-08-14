"""
Deterministic carry-forward composition.

What crosses a shift boundary is decided by rules here, never by the model — the
same split `context/derived_facts.py` and `risk/policy.py` keep. The LLM's only
job in this domain is to narrate a list it did not choose (see `narration.py`),
so a provider outage can degrade the prose but can never silently drop a hazard
out of the handover.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.risk.policy import dimensions_for

#: Presentation ordering only — the verdict itself is `risk/policy.classify`.
_RISK_ORDER: dict[str, int] = {"blocking": 0, "elevated": 1, "nominal": 2}

#: Item types, most urgent kind first, used as the tiebreak within a risk level.
_TYPE_ORDER: dict[str, int] = {
    "open_review": 0,
    "decision_condition": 1,
    "active_fact": 2,
    "open_task": 3,
    "note": 4,
}


def _rank(item: dict[str, Any]) -> tuple[int, int, str]:
    return (
        _RISK_ORDER.get(str(item.get("risk_level")), 3),
        _TYPE_ORDER.get(str(item.get("item_type")), 9),
        str(item.get("title") or ""),
    )


async def compose_carry_forward(
    session: AsyncSession, *, window_hours: int = 12
) -> list[dict[str, Any]]:
    """
    Everything the outgoing operator is still holding, as ordered item dicts.

    Returns plain dicts rather than rows so the caller can insert them, and so
    the rules stay testable without a handover row existing.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    items: list[dict[str, Any]] = []

    items.extend(await _open_reviews(session))
    items.extend(await _active_facts(session, since=since))
    items.extend(await _open_tasks(session))
    items.extend(await _decision_conditions(session, since=since))

    items.sort(key=_rank)
    for position, item in enumerate(items):
        item["position"] = position
    return items


async def _open_reviews(session: AsyncSession) -> list[dict[str, Any]]:
    """
    Every review still in flight, with the risk of its latest complete assessment.

    A review that has not been decided is unfinished work by definition, so it
    carries regardless of age. Acknowledgement is required once the AI or a
    supervisor has put it above nominal.
    """
    result = await session.execute(
        text(
            """
            SELECT r.id, r.asset_id, a.name AS asset_name, r.state, am.risk_level
            FROM reviews r
            JOIN assets a ON a.id = r.asset_id
            LEFT JOIN LATERAL (
                SELECT risk_level
                FROM assessments
                WHERE review_id = r.id AND status = 'complete'
                ORDER BY version DESC
                LIMIT 1
            ) am ON true
            WHERE r.state <> 'closed'
            ORDER BY r.created_at DESC
            """
        )
    )
    items: list[dict[str, Any]] = []
    for row in result.fetchall():
        m = row._mapping
        risk = str(m["risk_level"] or "nominal")
        state = str(m["state"]).replace("_", " ")
        items.append(
            {
                "item_type": "open_review",
                "review_id": m["id"],
                "asset_id": m["asset_id"],
                "asset_name": m["asset_name"],
                "task_id": None,
                "title": f"{m['asset_name']} — review {state}",
                "detail": (
                    f"Open review on {m['asset_name']}, currently {state}. "
                    f"Latest assessment risk: {risk}."
                ),
                "risk_level": risk,
                "hazard_dimensions": [],
                "requires_ack": risk in ("elevated", "blocking"),
                "source": "auto",
            }
        )
    return items


async def _active_facts(
    session: AsyncSession, *, since: datetime
) -> list[dict[str, Any]]:
    """
    Derived facts still true at the end of the shift.

    `DISTINCT ON` keeps only the newest value per (asset, fact type), so a fact
    that fired and then cleared during the shift does not carry. Acknowledgement
    is required when the fact supplies a hazard dimension — that is `risk/policy`
    deciding what is dangerous, not this module.
    """
    result = await session.execute(
        text(
            """
            SELECT DISTINCT ON (d.asset_id, d.fact_type)
                d.asset_id, a.name AS asset_name, d.fact_type, d.value, d.computed_at
            FROM derived_facts d
            JOIN assets a ON a.id = d.asset_id
            WHERE d.computed_at >= :since
            ORDER BY d.asset_id, d.fact_type, d.computed_at DESC
            """
        ),
        {"since": since},
    )
    items: list[dict[str, Any]] = []
    for row in result.fetchall():
        m = row._mapping
        value = m["value"]
        if isinstance(value, dict):
            value = value.get("value", value)
        if not (value is True or value == "true"):
            continue

        fact_type = str(m["fact_type"])
        dims = sorted(dimensions_for([fact_type]))
        items.append(
            {
                "item_type": "active_fact",
                "review_id": None,
                "asset_id": m["asset_id"],
                "asset_name": m["asset_name"],
                "task_id": None,
                "title": f"{m['asset_name']} — {fact_type.replace('_', ' ')}",
                "detail": (
                    f"Derived fact {fact_type} is still true as of "
                    f"{m['computed_at']:%H:%M}."
                ),
                "risk_level": "elevated" if dims else "nominal",
                "hazard_dimensions": dims,
                "requires_ack": bool(dims),
                "source": "auto",
            }
        )
    return items


async def _open_tasks(session: AsyncSession) -> list[dict[str, Any]]:
    """
    Follow-through work a decision spawned that nobody has completed.

    `unblock` tasks come from a `blocked` decision — the plant is stopped until
    they are done — so those always require acknowledgement.
    """
    result = await session.execute(
        text(
            """
            SELECT t.id, t.review_id, t.title, t.detail, t.task_type, t.status,
                   r.asset_id, a.name AS asset_name, w.name AS worker_name
            FROM review_tasks t
            JOIN reviews r ON r.id = t.review_id
            JOIN assets a ON a.id = r.asset_id
            LEFT JOIN workers w ON w.id = t.assigned_worker_id
            WHERE t.status IN ('open', 'acknowledged')
            ORDER BY t.created_at DESC
            """
        )
    )
    items: list[dict[str, Any]] = []
    for row in result.fetchall():
        m = row._mapping
        is_unblock = str(m["task_type"]) == "unblock"
        assignee = m["worker_name"] or "unassigned"
        items.append(
            {
                "item_type": "open_task",
                "review_id": m["review_id"],
                "asset_id": m["asset_id"],
                "asset_name": m["asset_name"],
                "task_id": m["id"],
                "title": str(m["title"]),
                "detail": (
                    f"{m['detail'] or 'No detail recorded.'} "
                    f"Assigned to {assignee}, status {m['status']}."
                ),
                "risk_level": "blocking" if is_unblock else "nominal",
                "hazard_dimensions": [],
                "requires_ack": is_unblock,
                "source": "auto",
            }
        )
    return items


async def _decision_conditions(
    session: AsyncSession, *, since: datetime
) -> list[dict[str, Any]]:
    """
    Conditions attached to work approved during the shift.

    A conditional approval is only as good as the condition surviving to the
    people doing the work. Conditions that die at shift change are the classic
    handover failure mode, so these always require acknowledgement.
    """
    result = await session.execute(
        text(
            """
            SELECT d.id, d.review_id, d.conditions, d.submitted_at,
                   r.asset_id, a.name AS asset_name, u.name AS decided_by_name
            FROM decisions d
            JOIN reviews r ON r.id = d.review_id
            JOIN assets a ON a.id = r.asset_id
            LEFT JOIN users u ON u.id = d.decided_by
            WHERE d.outcome = 'approved_with_conditions'
              AND d.submitted_at >= :since
              AND d.conditions IS NOT NULL
              AND btrim(d.conditions) <> ''
            ORDER BY d.submitted_at DESC
            """
        ),
        {"since": since},
    )
    items: list[dict[str, Any]] = []
    for row in result.fetchall():
        m = row._mapping
        decided_by = m["decided_by_name"] or "supervisor"
        items.append(
            {
                "item_type": "decision_condition",
                "review_id": m["review_id"],
                "asset_id": m["asset_id"],
                "asset_name": m["asset_name"],
                "task_id": None,
                "title": f"{m['asset_name']} — approved with conditions",
                "detail": (
                    f"{m['conditions']} (decided by {decided_by} at "
                    f"{m['submitted_at']:%H:%M})"
                ),
                "risk_level": "elevated",
                "hazard_dimensions": [],
                "requires_ack": True,
                "source": "auto",
            }
        )
    return items
