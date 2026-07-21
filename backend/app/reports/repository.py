"""
SQL for reports. No packet logic, no HTTP — the other domains are layered
routes → service → repository and reports was the one that kept raw SQL in its
service module.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Mapping
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

def _rows(result) -> list[dict[str, Any]]:
    return [dict(r._mapping) for r in result.fetchall()]


async def next_closure_seq(session: AsyncSession, review_id: UUID) -> int:
    """
    Next sequence number for this review's reports.

    `MAX(seq)+1`, not `COUNT(*)+1`: a demo reset deletes report rows, and a count
    would then hand out a number that had already been used.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": f"report_seq:{review_id}"},
    )
    result = await session.execute(
        text(
            """
            SELECT COALESCE(MAX(closure_event_seq), 0) + 1 AS n
            FROM reports
            WHERE review_id = CAST(:review_id AS uuid)
            """
        ),
        {"review_id": str(review_id)},
    )
    return int(result.scalar_one())


async def latest_report_id(session: AsyncSession, review_id: UUID) -> UUID | None:
    result = await session.execute(
        text(
            """
            SELECT id FROM reports
            WHERE review_id = CAST(:review_id AS uuid)
            ORDER BY closure_event_seq DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review_id)},
    )
    row = result.first()
    return row[0] if row else None


async def insert_report(
    session: AsyncSession,
    *,
    review_id: UUID,
    closure_event_seq: int,
    content: dict,
    content_hash: str,
    packet_version: int,
    supersedes_report_id: UUID | None,
    closed_by: str,
    frozen_at: datetime,
    evidence_id: UUID | None,
    snapshot_hash: str | None,
) -> UUID:
    result = await session.execute(
        text(
            """
            INSERT INTO reports (
                review_id, closure_event_seq, content, content_hash,
                packet_version, supersedes_report_id, closed_by, frozen_at,
                evidence_id, snapshot_hash
            )
            VALUES (
                CAST(:review_id AS uuid), :seq, CAST(:content AS jsonb), :content_hash,
                :packet_version, CAST(:supersedes AS uuid), :closed_by, :frozen_at,
                CAST(:evidence_id AS uuid), :snapshot_hash
            )
            RETURNING id
            """
        ),
        {
            "review_id": str(review_id),
            "seq": closure_event_seq,
            "content": json.dumps(content, default=str),
            "content_hash": content_hash,
            "packet_version": packet_version,
            "supersedes": str(supersedes_report_id) if supersedes_report_id else None,
            "closed_by": closed_by,
            "frozen_at": frozen_at,
            "evidence_id": str(evidence_id) if evidence_id else None,
            "snapshot_hash": snapshot_hash,
        },
    )
    return result.scalar_one()


_REPORT_COLUMNS = """
    r.id, r.review_id, r.closure_event_seq, r.content, r.generated_at,
    r.content_hash, r.packet_version, r.supersedes_report_id, r.closed_by,
    r.frozen_at, r.evidence_id, r.snapshot_hash,
    (r.closure_event_seq = MAX(r.closure_event_seq)
        OVER (PARTITION BY r.review_id)) AS is_current
"""


async def select_report(session: AsyncSession, report_id: UUID) -> Mapping | None:
    result = await session.execute(
        text(
            f"""
            SELECT {_REPORT_COLUMNS}
            FROM reports r
            WHERE r.review_id = (
                SELECT review_id FROM reports WHERE id = CAST(:id AS uuid)
            )
            """
        ),
        {"id": str(report_id)},
    )
    for row in _rows(result):
        if str(row["id"]) == str(report_id):
            return row
    return None


async def select_versions_for_review(
    session: AsyncSession, review_id: UUID
) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            f"""
            SELECT {_REPORT_COLUMNS}
            FROM reports r
            WHERE r.review_id = CAST(:review_id AS uuid)
            ORDER BY r.closure_event_seq ASC
            """
        ),
        {"review_id": str(review_id)},
    )
    return _rows(result)


async def select_reports(
    session: AsyncSession,
    *,
    review_id: UUID | None = None,
    include_superseded: bool = False,
    outcome: str | None = None,
    risk_level: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """
    Report rows for the register, newest first.

    Filtering on outcome/risk reads the frozen `content`, because those live on
    the packet rather than on a column — they are properties of what was frozen,
    not of the row.
    """
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if review_id is not None:
        clauses.append("r.review_id = CAST(:review_id AS uuid)")
        params["review_id"] = str(review_id)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    # `is_current` filters in SQL via the window; outcome/risk read JSONB and are
    # applied in Python. Both must run *before* limit/offset, so the page is
    # ordered and sliced over the already-filtered set — filtering after LIMIT
    # would silently drop current rows whenever superseded ones filled the page.
    current_clause = "WHERE is_current" if not include_superseded else ""
    result = await session.execute(
        text(
            f"""
            SELECT * FROM (
                SELECT {_REPORT_COLUMNS}
                FROM reports r
                {where}
            ) ranked
            {current_clause}
            ORDER BY generated_at DESC
            """
        ),
        params,
    )
    rows = _rows(result)
    if outcome or risk_level:
        rows = [r for r in rows if _matches(r, outcome, risk_level)]
    return rows[offset : offset + limit]


def _content(row: Mapping) -> dict:
    raw = row.get("content")
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return raw or {}


def _matches(row: Mapping, outcome: str | None, risk_level: str | None) -> bool:
    content = _content(row)
    decision = content.get("decision") or {}
    assessment = content.get("assessment") or content.get("assessment_snapshot") or {}
    if outcome and str(decision.get("outcome") or "") != outcome:
        return False
    if risk_level and str(assessment.get("risk_level") or "") != risk_level:
        return False
    return True


# --------------------------------------------------------------------------
# Sources the packet builder reads
# --------------------------------------------------------------------------

async def select_asset(session: AsyncSession, asset_id: UUID) -> Mapping | None:
    result = await session.execute(
        text(
            "SELECT id, name, zone, plant_id, floor FROM assets "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": str(asset_id)},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def select_review_row(session: AsyncSession, review_id: UUID) -> Mapping | None:
    result = await session.execute(
        text(
            """
            SELECT r.id, r.state, r.origin, r.triggered_by, r.owner_id,
                   r.raised_by_worker_id, r.tagged_worker_ids,
                   r.report_description, r.report_concern_type,
                   r.created_at, r.closed_at,
                   u.name AS owner_name, u.role AS owner_role
            FROM reviews r
            LEFT JOIN users u ON u.id = r.owner_id
            WHERE r.id = CAST(:id AS uuid)
            """
        ),
        {"id": str(review_id)},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def select_latest_evidence(session: AsyncSession, review_id: UUID) -> Mapping | None:
    result = await session.execute(
        text(
            """
            SELECT id, decision_id, frozen_context_ids, frozen_assessment_id,
                   frozen_context_snapshot, frozen_assessment_snapshot,
                   snapshot_hash, captured_at
            FROM evidence
            WHERE review_id = CAST(:review_id AS uuid)
            ORDER BY captured_at DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review_id)},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def select_latest_decision(session: AsyncSession, review_id: UUID) -> Mapping | None:
    result = await session.execute(
        text(
            """
            SELECT d.id, d.assessment_id, d.decided_by, d.outcome, d.conditions,
                   d.comments, d.submitted_at,
                   u.name AS decided_by_name, u.role AS decided_by_role
            FROM decisions d
            LEFT JOIN users u ON u.id = d.decided_by
            WHERE d.review_id = CAST(:review_id AS uuid)
            ORDER BY d.submitted_at DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review_id)},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def select_assessment(session: AsyncSession, assessment_id: UUID) -> Mapping | None:
    result = await session.execute(
        text(
            """
            SELECT a.id, a.version, a.assessment_type, a.status, a.risk_level,
                   a.summary, a.created_at, a.derived_fact_ids,
                   m.provider, m.model, m.confidence, m.retrieval_mode,
                   m.retrieval_quality, m.latency_ms, m.cost_usd,
                   m.tokens_in, m.tokens_out, m.failure_reason,
                   m.retrieved_references, m.reasoning_factors
            FROM assessments a
            LEFT JOIN assessment_metadata m ON m.assessment_id = a.id
            WHERE a.id = CAST(:id AS uuid)
            """
        ),
        {"id": str(assessment_id)},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def select_latest_complete_assessment(
    session: AsyncSession, review_id: UUID
) -> Mapping | None:
    result = await session.execute(
        text(
            """
            SELECT id FROM assessments
            WHERE review_id = CAST(:review_id AS uuid) AND status = 'complete'
            ORDER BY version DESC, created_at DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review_id)},
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def select_recommendations(
    session: AsyncSession, assessment_id: UUID
) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT id, text, rationale, disposition
            FROM recommendations
            WHERE assessment_id = CAST(:aid AS uuid)
            ORDER BY id
            """
        ),
        {"aid": str(assessment_id)},
    )
    return _rows(result)


async def select_facts(session: AsyncSession, fact_ids: list[str]) -> list[dict[str, Any]]:
    if not fact_ids:
        return []
    result = await session.execute(
        text(
            """
            SELECT id, fact_type, value, computed_at, source_context_ids
            FROM derived_facts
            WHERE id = ANY(CAST(:ids AS uuid[]))
            ORDER BY computed_at
            """
        ),
        {"ids": fact_ids},
    )
    return _rows(result)


async def select_facts_for_asset(
    session: AsyncSession, asset_id: UUID
) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT DISTINCT ON (fact_type)
                   id, fact_type, value, computed_at, source_context_ids
            FROM derived_facts
            WHERE asset_id = CAST(:asset_id AS uuid)
            ORDER BY fact_type, computed_at DESC
            """
        ),
        {"asset_id": str(asset_id)},
    )
    return _rows(result)


async def select_tasks(session: AsyncSession, review_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT t.id, t.task_type, t.title, t.detail, t.status, t.created_by,
                   t.created_at, t.acknowledged_at, t.done_at, t.done_note,
                   w.name AS assigned_worker_name
            FROM review_tasks t
            LEFT JOIN workers w ON w.id = t.assigned_worker_id
            WHERE t.review_id = CAST(:review_id AS uuid)
            ORDER BY t.created_at
            """
        ),
        {"review_id": str(review_id)},
    )
    return _rows(result)


async def select_comments(session: AsyncSession, review_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            """
            SELECT id, author_kind, author_name, body, created_at
            FROM review_comments
            WHERE review_id = CAST(:review_id AS uuid)
            ORDER BY created_at
            """
        ),
        {"review_id": str(review_id)},
    )
    return _rows(result)


async def select_audit_entries(
    session: AsyncSession, entity_ids: list[str]
) -> list[dict[str, Any]]:
    if not entity_ids:
        return []
    result = await session.execute(
        text(
            """
            SELECT seq, recorded_at, entity_type, entity_id, event_type, actor,
                   prev_hash, entry_hash
            FROM audit_entries
            WHERE entity_id = ANY(CAST(:ids AS uuid[]))
            ORDER BY seq ASC
            """
        ),
        {"ids": entity_ids},
    )
    return _rows(result)


async def select_workers_by_id(
    session: AsyncSession, worker_ids: list[str]
) -> dict[str, str]:
    if not worker_ids:
        return {}
    result = await session.execute(
        text("SELECT id, name FROM workers WHERE id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": worker_ids},
    )
    return {str(r._mapping["id"]): r._mapping["name"] for r in result.fetchall()}
