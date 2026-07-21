"""Manual Assessment path — supervisor-authored Complete Assessment."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessment.orchestrator import PROMPT_VERSION, _true_fact_ids
from app.assessment.retrieval.enrich import enrich_references, serialize_ref
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

    # Cancel in-flight AI jobs as well as prior completes — otherwise a
    # generating worker can finish later and crash on assessment_completed.
    await session.execute(
        text(
            """
            UPDATE assessments
            SET status = 'superseded',
                summary = COALESCE(
                    summary,
                    'Superseded by manual assessment'
                )
            WHERE review_id = CAST(:review_id AS uuid)
              AND status IN ('pending', 'generating', 'complete')
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
                retrieved_references, retrieval_mode, retrieval_quality,
                reasoning_factors
            )
            VALUES (
                CAST(:aid AS uuid), 'manual', 'human', :pv,
                0, 0, 0, 0, 1.0,
                '[]'::jsonb, 'skipped', 'n_a',
                '[]'::jsonb
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
        recommendations=recommendations,
        summary=body.summary,
        derived_fact_ids=fact_ids,
        metadata=None,
        reasoning_factors=[],
    )


def _parse_reasoning_factors(raw) -> list[dict]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        evidence = item.get("evidence") or []
        if isinstance(evidence, str):
            try:
                evidence = json.loads(evidence)
            except json.JSONDecodeError:
                evidence = []
        out.append(
            {
                "fact_type": item.get("fact_type", ""),
                "headline": item.get("headline", ""),
                "detail": item.get("detail", ""),
                "evidence": evidence if isinstance(evidence, list) else [],
                "context_ids": [str(x) for x in (item.get("context_ids") or [])],
            }
        )
    return out


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
                   m.embedding_model, m.reasoning_factors, m.agent_trace
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
            raw_refs = json.loads(raw_refs)
        stub_refs = list(raw_refs) if isinstance(raw_refs, list) else []
        enriched = await enrich_references(session, stub_refs)
        retrieved_references = [serialize_ref(r) for r in enriched]
        reasoning_factors = _parse_reasoning_factors(m.get("reasoning_factors"))
        for factor in reasoning_factors:
            ev = factor.get("evidence") or []
            if ev and not any(isinstance(e, dict) and e.get("title") for e in ev):
                factor["evidence"] = [
                    serialize_ref(r) for r in await enrich_references(session, ev)
                ]
        raw_trace = m.get("agent_trace") or []
        if isinstance(raw_trace, str):
            raw_trace = json.loads(raw_trace)
        agent_trace = list(raw_trace) if isinstance(raw_trace, list) else []
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
                "reasoning_factors": reasoning_factors,
                "agent_trace": agent_trace,
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
                "reasoning_factors": reasoning_factors,
                "agent_trace": agent_trace,
                "metadata": meta,
            }
        )
    return out
