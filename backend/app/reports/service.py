"""Report generation on review closure."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.realtime.connection_manager import manager
from shared.python.schemas import Review

logger = logging.getLogger(__name__)


def _iso(value: object) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()  # type: ignore[no-any-return]
    return str(value)


async def generate_report_on_closure(
    session: AsyncSession, review: Review
) -> UUID:
    """Build and persist a closure report. Caller owns the transaction context."""
    asset_result = await session.execute(
        text(
            """
            SELECT id, name, zone, plant_id, floor FROM assets
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": str(review.asset_id)},
    )
    asset_row = asset_result.first()
    asset = (
        {
            "id": str(asset_row._mapping["id"]),
            "name": asset_row._mapping["name"],
            "zone": asset_row._mapping["zone"],
            "plant_id": asset_row._mapping["plant_id"],
            "floor": asset_row._mapping["floor"] or "ground",
        }
        if asset_row
        else {
            "id": str(review.asset_id),
            "name": "unknown",
            "zone": "unknown",
            "plant_id": "unknown",
            "floor": "ground",
        }
    )

    seq_result = await session.execute(
        text(
            """
            SELECT COUNT(*) AS n FROM reports
            WHERE review_id = CAST(:review_id AS uuid)
            """
        ),
        {"review_id": str(review.id)},
    )
    closure_event_seq = int(seq_result.scalar_one()) + 1

    assessment_result = await session.execute(
        text(
            """
            SELECT a.id, a.risk_level, a.summary, a.version,
                   m.provider, m.retrieval_mode, m.retrieval_quality, m.confidence
            FROM assessments a
            LEFT JOIN assessment_metadata m ON m.assessment_id = a.id
            WHERE a.review_id = CAST(:review_id AS uuid)
              AND a.status = 'complete'
            ORDER BY a.version DESC, a.created_at DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review.id)},
    )
    assessment_row = assessment_result.first()
    recommendations: list[dict] = []
    assessment_snapshot: dict | None = None
    if assessment_row:
        am = assessment_row._mapping
        recs = await session.execute(
            text(
                """
                SELECT id, text, rationale, disposition
                FROM recommendations
                WHERE assessment_id = CAST(:aid AS uuid)
                ORDER BY id
                """
            ),
            {"aid": str(am["id"])},
        )
        recommendations = [
            {
                "id": str(r._mapping["id"]),
                "text": r._mapping["text"],
                "rationale": r._mapping["rationale"],
                "disposition": r._mapping["disposition"],
            }
            for r in recs.fetchall()
        ]
        assessment_snapshot = {
            "id": str(am["id"]),
            "risk_level": am["risk_level"],
            "summary": am["summary"],
            "version": am["version"],
            "recommendations": recommendations,
            "metadata": {
                "provider": am["provider"],
                "retrieval_mode": am["retrieval_mode"],
                "retrieval_quality": am["retrieval_quality"],
                "confidence": am["confidence"],
            },
        }

    decision_result = await session.execute(
        text(
            """
            SELECT id, assessment_id, decided_by, outcome, conditions, comments, submitted_at
            FROM decisions
            WHERE review_id = CAST(:review_id AS uuid)
            ORDER BY submitted_at DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review.id)},
    )
    decision_row = decision_result.first()
    decision_snap: dict | None = None
    if decision_row:
        dm = decision_row._mapping
        decision_snap = {
            "id": str(dm["id"]),
            "assessment_id": str(dm["assessment_id"]),
            "decided_by": str(dm["decided_by"]),
            "outcome": dm["outcome"],
            "conditions": dm["conditions"],
            "comments": dm.get("comments"),
            "submitted_at": _iso(dm["submitted_at"]),
        }

    evidence_result = await session.execute(
        text(
            """
            SELECT id, decision_id, frozen_context_ids, frozen_assessment_id, captured_at
            FROM evidence
            WHERE review_id = CAST(:review_id AS uuid)
            ORDER BY captured_at DESC
            LIMIT 1
            """
        ),
        {"review_id": str(review.id)},
    )
    evidence_row = evidence_result.first()
    evidence_snap: dict | None = None
    if evidence_row:
        em = evidence_row._mapping
        evidence_snap = {
            "id": str(em["id"]),
            "decision_id": str(em["decision_id"]),
            "frozen_context_ids": [str(x) for x in (em["frozen_context_ids"] or [])],
            "frozen_assessment_id": str(em["frozen_assessment_id"]),
            "captured_at": _iso(em["captured_at"]),
        }

    now = datetime.now(timezone.utc)
    outcome = decision_snap["outcome"] if decision_snap else "unknown"
    title = f"Closure Report — {asset['name']} ({outcome.replace('_', ' ')})"
    content = {
        "title": title,
        "asset": asset,
        "assessment_snapshot": assessment_snapshot,
        "decision": decision_snap,
        "evidence": evidence_snap,
        "closure_event_seq": closure_event_seq,
        "generated_at": now.isoformat(),
        "review": {
            "id": str(review.id),
            "state": review.state,
            "triggered_by": review.triggered_by,
            "owner_id": str(review.owner_id),
        },
    }

    insert = await session.execute(
        text(
            """
            INSERT INTO reports (review_id, closure_event_seq, content)
            VALUES (
                CAST(:review_id AS uuid),
                :seq,
                CAST(:content AS jsonb)
            )
            RETURNING id, generated_at
            """
        ),
        {
            "review_id": str(review.id),
            "seq": closure_event_seq,
            "content": json.dumps(content),
        },
    )
    rm = insert.one()._mapping
    report_id = rm["id"]

    await record_audit(
        session,
        entity_type="report",
        entity_id=report_id,
        event_type="report.generated",
        actor="system:closure",
        payload={
            "review_id": str(review.id),
            "closure_event_seq": closure_event_seq,
            "outcome": outcome,
        },
    )

    # Notify on close (deterministic template).
    from app.notifications.service import notify_review_closed

    await notify_review_closed(
        session, review_id=review.id, owner_id=review.owner_id
    )

    await session.commit()

    await manager.broadcast(
        "report.generated",
        {
            "report_id": str(report_id),
            "review_id": str(review.id),
            "closure_event_seq": closure_event_seq,
        },
    )
    logger.info(
        "report %s generated for review %s (seq=%d)",
        report_id,
        review.id,
        closure_event_seq,
    )
    return report_id


def _row_to_out(m: object) -> dict:
    mapping = m  # type: ignore[assignment]
    content = mapping["content"]  # type: ignore[index]
    if isinstance(content, str):
        content = json.loads(content)
    return {
        "id": str(mapping["id"]),  # type: ignore[index]
        "review_id": str(mapping["review_id"]),  # type: ignore[index]
        "closure_event_seq": mapping["closure_event_seq"],  # type: ignore[index]
        "content": content,
        "generated_at": _iso(mapping["generated_at"]),  # type: ignore[index]
    }


def _to_summary(row_dict: dict) -> dict:
    content = row_dict.get("content") or {}
    asset = content.get("asset") or {}
    decision = content.get("decision") or {}
    assessment = content.get("assessment_snapshot") or {}
    return {
        "id": row_dict["id"],
        "review_id": row_dict["review_id"],
        "closure_event_seq": row_dict["closure_event_seq"],
        "generated_at": row_dict["generated_at"],
        "title": content.get("title"),
        "asset_name": asset.get("name"),
        "outcome": decision.get("outcome"),
        "risk_level": assessment.get("risk_level"),
    }


async def list_reports(session: AsyncSession) -> list[dict]:
    result = await session.execute(
        text(
            """
            SELECT id, review_id, closure_event_seq, content, generated_at
            FROM reports
            ORDER BY generated_at DESC
            """
        )
    )
    return [_to_summary(_row_to_out(row._mapping)) for row in result.fetchall()]


async def list_reports_for_review(
    session: AsyncSession, review_id: UUID
) -> list[dict]:
    result = await session.execute(
        text(
            """
            SELECT id, review_id, closure_event_seq, content, generated_at
            FROM reports
            WHERE review_id = CAST(:review_id AS uuid)
            ORDER BY closure_event_seq DESC
            """
        ),
        {"review_id": str(review_id)},
    )
    return [_row_to_out(row._mapping) for row in result.fetchall()]


async def get_report(session: AsyncSession, report_id: UUID) -> dict | None:
    result = await session.execute(
        text(
            """
            SELECT id, review_id, closure_event_seq, content, generated_at
            FROM reports
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": str(report_id)},
    )
    row = result.first()
    return _row_to_out(row._mapping) if row else None
