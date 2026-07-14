"""Manual Assessment path — supervisor-authored Complete Assessment."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessment.orchestrator import PROMPT_VERSION, _true_fact_ids
from app.realtime.connection_manager import manager
from app.reviews.repository import get_review, transition_review
from app.reviews.state_machine import IllegalTransitionError, ReviewEvent
from shared.python.schemas import Assessment, ManualAssessmentIn, Recommendation

logger = logging.getLogger(__name__)


async def create_manual_assessment(
    session: AsyncSession,
    review_id: UUID,
    body: ManualAssessmentIn,
    *,
    actor: str = "api:manual_assessment",
) -> Assessment:
    review = await get_review(session, review_id)
    if review is None:
        raise LookupError(f"Review {review_id} not found")
    if review.state != "assessing":
        raise IllegalTransitionError(review.state, ReviewEvent.ASSESSMENT_COMPLETED)

    fact_ids = await _true_fact_ids(session, review.asset_id)
    ver_row = await session.execute(
        text(
            """
            SELECT COALESCE(MAX(version), 0) AS v
            FROM assessments
            WHERE review_id = CAST(:review_id AS uuid)
            """
        ),
        {"review_id": str(review_id)},
    )
    version = int(ver_row.scalar_one()) + 1

    # Supersede prior complete
    await session.execute(
        text(
            """
            UPDATE assessments
            SET status = 'superseded'
            WHERE review_id = CAST(:review_id AS uuid)
              AND status = 'complete'
            """
        ),
        {"review_id": str(review_id)},
    )

    result = await session.execute(
        text(
            """
            INSERT INTO assessments (
                review_id, assessment_type, status, risk_level, summary,
                derived_fact_ids, version
            )
            VALUES (
                CAST(:review_id AS uuid),
                'manual',
                'complete',
                :risk,
                :summary,
                CAST(:fact_ids AS uuid[]),
                :version
            )
            RETURNING id
            """
        ),
        {
            "review_id": str(review_id),
            "risk": body.risk_level,
            "summary": body.summary,
            "fact_ids": [str(i) for i in fact_ids],
            "version": version,
        },
    )
    assessment_id = result.scalar_one()

    recommendations: list[Recommendation] = []
    for rec in body.recommendations:
        rec_row = await session.execute(
            text(
                """
                INSERT INTO recommendations (assessment_id, text, rationale, disposition)
                VALUES (CAST(:aid AS uuid), :text, :rationale, 'proposed')
                RETURNING id, text, rationale, disposition
                """
            ),
            {
                "aid": str(assessment_id),
                "text": rec.text,
                "rationale": rec.rationale,
            },
        )
        rm = rec_row.one()._mapping
        recommendations.append(
            Recommendation(
                id=rm["id"],
                text=rm["text"],
                rationale=rm["rationale"],
                disposition=rm["disposition"],
            )
        )

    await session.execute(
        text(
            """
            INSERT INTO assessment_metadata (
                assessment_id, provider, model, prompt_version,
                tokens_in, tokens_out, cost_usd, latency_ms, confidence,
                retrieved_references, retrieval_mode, retrieval_quality
            )
            VALUES (
                CAST(:aid AS uuid), 'manual', 'human', :pv,
                0, 0, 0, 0, 1.0,
                '[]'::jsonb, 'skipped', 'n_a'
            )
            """
        ),
        {"aid": str(assessment_id), "pv": PROMPT_VERSION},
    )
    await session.commit()

    await transition_review(
        session,
        review_id,
        ReviewEvent.ASSESSMENT_COMPLETED,
        actor,
        extra_payload={"assessment_id": str(assessment_id), "manual": True},
    )

    await manager.broadcast(
        "assessment.completed",
        {
            "assessment_id": str(assessment_id),
            "review_id": str(review_id),
            "risk_level": body.risk_level,
            "retrieval_mode": "skipped",
            "provider": "manual",
            "ts": datetime.now(timezone.utc).isoformat(),
        },
    )

    return Assessment(
        id=assessment_id,
        review_id=review_id,
        assessment_type="manual",
        status="complete",
        risk_level=body.risk_level,
        summary=body.summary,
        recommendations=recommendations,
        derived_fact_ids=fact_ids,
        metadata=None,
    )


async def list_assessments(session: AsyncSession, review_id: UUID) -> list[dict]:
    result = await session.execute(
        text(
            """
            SELECT a.id, a.review_id, a.assessment_type, a.status,
                   a.risk_level, a.summary, a.derived_fact_ids, a.version, a.created_at,
                   m.provider, m.model, m.prompt_version, m.tokens_in, m.tokens_out,
                   m.cost_usd, m.latency_ms, m.confidence,
                   m.retrieved_context_ids, m.retrieved_evidence_ids,
                   m.retrieved_references,
                   m.retrieval_mode, m.retrieval_quality, m.retrieval_score,
                   m.embedding_model
            FROM assessments a
            LEFT JOIN assessment_metadata m ON m.assessment_id = a.id
            WHERE a.review_id = CAST(:review_id AS uuid)
            ORDER BY a.version DESC, a.created_at DESC
            """
        ),
        {"review_id": str(review_id)},
    )
    out: list[dict] = []
    for row in result.fetchall():
        m = dict(row._mapping)
        aid = m["id"]
        recs = await session.execute(
            text(
                """
                SELECT id, text, rationale, disposition
                FROM recommendations
                WHERE assessment_id = CAST(:aid AS uuid)
                ORDER BY id
                """
            ),
            {"aid": str(aid)},
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
        raw_refs = m.get("retrieved_references") or []
        if isinstance(raw_refs, str):
            import json

            raw_refs = json.loads(raw_refs)
        retrieved_references = list(raw_refs) if isinstance(raw_refs, list) else []
        meta = None
        if m.get("provider") is not None:
            meta = {
                "provider": m["provider"],
                "model": m["model"],
                "prompt_version": m["prompt_version"],
                "input_tokens": m["tokens_in"] or 0,
                "output_tokens": m["tokens_out"] or 0,
                "estimated_cost_usd": m["cost_usd"] or 0.0,
                "latency_ms": m["latency_ms"] or 0,
                "confidence": m["confidence"],
                "retrieved_context_ids": [
                    str(x) for x in (m["retrieved_context_ids"] or [])
                ],
                "retrieved_evidence_ids": [
                    str(x) for x in (m["retrieved_evidence_ids"] or [])
                ],
                "retrieval_mode": m["retrieval_mode"],
                "retrieval_quality": m["retrieval_quality"],
                "retrieval_score": m["retrieval_score"],
                "embedding_model": m["embedding_model"],
                "assessment_version": m["version"],
            }
        out.append(
            {
                "id": str(m["id"]),
                "review_id": str(m["review_id"]),
                "assessment_type": m["assessment_type"],
                "status": m["status"],
                "risk_level": m["risk_level"],
                "summary": m["summary"],
                "derived_fact_ids": [str(x) for x in (m["derived_fact_ids"] or [])],
                "version": m["version"],
                "created_at": m["created_at"].isoformat() if m["created_at"] else None,
                "recommendations": recommendations,
                "retrieved_references": retrieved_references,
                "metadata": meta,
            }
        )
    return out
