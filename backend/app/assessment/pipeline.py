"""Assessment pipeline execution — retrieve → generate → validate/retry → persist."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessment.orchestrator import PROMPT_VERSION
from app.assessment.providers import get_provider
from app.assessment.retrieval import build_retrieval_query, retrieve
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.realtime.connection_manager import manager
from app.reviews.repository import get_review, transition_review
from app.reviews.state_machine import ReviewEvent
from shared.python.schemas import DerivedFact

logger = logging.getLogger(__name__)


async def _load_true_facts(
    session: AsyncSession, asset_id: UUID
) -> list[DerivedFact]:
    result = await session.execute(
        text(
            """
            SELECT DISTINCT ON (fact_type)
                id, asset_id, fact_type, value, computed_at, source_context_ids
            FROM derived_facts
            WHERE asset_id = CAST(:asset_id AS uuid)
            ORDER BY fact_type, computed_at DESC
            """
        ),
        {"asset_id": str(asset_id)},
    )
    facts: list[DerivedFact] = []
    for row in result.fetchall():
        m = row._mapping
        value = m["value"]
        if isinstance(value, dict):
            value = value.get("value", value)
        if not (value is True or value == "true"):
            continue
        facts.append(
            DerivedFact(
                id=m["id"],
                asset_id=m["asset_id"],
                fact_type=m["fact_type"],
                value=True,
                computed_at=m["computed_at"],
                source_context_ids=list(m["source_context_ids"] or []),
            )
        )
    return facts


async def _load_asset(session: AsyncSession, asset_id: UUID) -> tuple[str, str]:
    result = await session.execute(
        text(
            "SELECT name, zone FROM assets WHERE id = CAST(:id AS uuid)"
        ),
        {"id": str(asset_id)},
    )
    row = result.first()
    if row is None:
        return ("unknown", "unknown")
    return (row._mapping["name"], row._mapping["zone"])


async def _context_ids(session: AsyncSession, asset_id: UUID) -> list[UUID]:
    result = await session.execute(
        text(
            """
            SELECT id FROM context_entries
            WHERE asset_id = CAST(:asset_id AS uuid)
              AND valid_from <= now()
              AND valid_until > now()
            ORDER BY valid_from DESC
            LIMIT 50
            """
        ),
        {"asset_id": str(asset_id)},
    )
    return [row._mapping["id"] for row in result.fetchall()]


async def _persist_metadata(
    session: AsyncSession,
    assessment_id: UUID,
    *,
    provider: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    latency_ms: int,
    confidence: float,
    context_ids: list[UUID],
    evidence_ids: list[UUID],
    retrieval_mode: str,
    retrieval_quality: str,
    retrieval_score: float | None,
    embedding_model: str | None,
) -> None:
    await session.execute(
        text(
            """
            INSERT INTO assessment_metadata (
                assessment_id, provider, model, prompt_version,
                tokens_in, tokens_out, cost_usd, latency_ms, confidence,
                retrieved_context_ids, retrieved_evidence_ids,
                retrieval_mode, retrieval_quality, retrieval_score, embedding_model
            )
            VALUES (
                CAST(:aid AS uuid), :provider, :model, :prompt_version,
                :tokens_in, :tokens_out, :cost_usd, :latency_ms, :confidence,
                CAST(:ctx AS uuid[]), CAST(:ev AS uuid[]),
                :retrieval_mode, :retrieval_quality, :retrieval_score, :embedding_model
            )
            ON CONFLICT (assessment_id) DO UPDATE SET
                provider = EXCLUDED.provider,
                model = EXCLUDED.model,
                prompt_version = EXCLUDED.prompt_version,
                tokens_in = EXCLUDED.tokens_in,
                tokens_out = EXCLUDED.tokens_out,
                cost_usd = EXCLUDED.cost_usd,
                latency_ms = EXCLUDED.latency_ms,
                confidence = EXCLUDED.confidence,
                retrieved_context_ids = EXCLUDED.retrieved_context_ids,
                retrieved_evidence_ids = EXCLUDED.retrieved_evidence_ids,
                retrieval_mode = EXCLUDED.retrieval_mode,
                retrieval_quality = EXCLUDED.retrieval_quality,
                retrieval_score = EXCLUDED.retrieval_score,
                embedding_model = EXCLUDED.embedding_model
            """
        ),
        {
            "aid": str(assessment_id),
            "provider": provider,
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "latency_ms": latency_ms,
            "confidence": confidence,
            "ctx": [str(i) for i in context_ids],
            "ev": [str(i) for i in evidence_ids],
            "retrieval_mode": retrieval_mode,
            "retrieval_quality": retrieval_quality,
            "retrieval_score": retrieval_score,
            "embedding_model": embedding_model,
        },
    )


async def run_assessment_job(
    assessment_id: UUID, *, provider_name: str | None = None
) -> None:
    settings = get_settings()
    async with SessionLocal() as session:
        row = await session.execute(
            text(
                """
                SELECT id, review_id, status, version
                FROM assessments
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": str(assessment_id)},
        )
        assessment = row.first()
        if assessment is None:
            logger.warning("assessment %s not found", assessment_id)
            return
        am = assessment._mapping
        if am["status"] not in ("pending", "generating"):
            logger.info(
                "skip assessment %s — status=%s", assessment_id, am["status"]
            )
            return

        review_id = am["review_id"]
        await session.execute(
            text(
                """
                UPDATE assessments SET status = 'generating'
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": str(assessment_id)},
        )
        await session.commit()

        review = await get_review(session, review_id)
        if review is None:
            logger.error("review %s missing for assessment %s", review_id, assessment_id)
            return

        facts = await _load_true_facts(session, review.asset_id)
        context_ids = await _context_ids(session, review.asset_id)
        asset_name, asset_zone = await _load_asset(session, review.asset_id)
        fact_types = [f.fact_type for f in facts]
        query = build_retrieval_query(
            fact_types=fact_types,
            triggered_by=review.triggered_by,
            asset_name=asset_name,
            asset_zone=asset_zone,
        )

        hybrid = await retrieve(session, query=query, fact_types=fact_types)
        evidence_ids = [r.id for r in hybrid.refs]
        provider = get_provider(provider_name)

        generation = None
        last_error: Exception | None = None
        max_retries = settings.assessment_max_retries
        for attempt in range(max_retries + 1):
            repair = None
            if attempt > 0 and last_error is not None:
                repair = (
                    f"Previous output failed validation: {last_error}. "
                    "Return valid JSON with summary, risk_level "
                    "(nominal|elevated|blocking), confidence, and recommendations[]."
                )
            try:
                generation = await provider.generate_assessment(
                    facts,
                    context_ids,
                    hybrid.refs,
                    repair_hint=repair,
                )
                last_error = None
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                logger.warning(
                    "provider attempt %d failed for %s: %s",
                    attempt + 1,
                    assessment_id,
                    exc,
                )

        if generation is None or last_error is not None:
            await session.execute(
                text(
                    """
                    UPDATE assessments
                    SET status = 'failed', summary = :summary
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {
                    "id": str(assessment_id),
                    "summary": f"Assessment generation failed: {last_error}",
                },
            )
            await _persist_metadata(
                session,
                assessment_id,
                provider=provider_name or settings.ai_provider,
                model="unknown",
                tokens_in=0,
                tokens_out=0,
                cost_usd=0.0,
                latency_ms=0,
                confidence=0.0,
                context_ids=context_ids,
                evidence_ids=evidence_ids,
                retrieval_mode=hybrid.mode,
                retrieval_quality=hybrid.quality,
                retrieval_score=hybrid.best_score,
                embedding_model=hybrid.embedding_model,
            )
            await session.commit()
            await manager.broadcast(
                "assessment.failed",
                {
                    "assessment_id": str(assessment_id),
                    "review_id": str(review_id),
                    "error": str(last_error),
                    "ts": datetime.now(timezone.utc).isoformat(),
                },
            )
            return

        # Supersede prior complete assessments
        await session.execute(
            text(
                """
                UPDATE assessments
                SET status = 'superseded'
                WHERE review_id = CAST(:review_id AS uuid)
                  AND status = 'complete'
                  AND id <> CAST(:id AS uuid)
                """
            ),
            {"review_id": str(review_id), "id": str(assessment_id)},
        )

        result = generation.result
        await session.execute(
            text(
                """
                UPDATE assessments
                SET status = 'complete',
                    risk_level = :risk,
                    summary = :summary,
                    derived_fact_ids = CAST(:fact_ids AS uuid[])
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {
                "id": str(assessment_id),
                "risk": result.risk_level,
                "summary": result.summary,
                "fact_ids": [str(f.id) for f in facts],
            },
        )

        for rec in result.recommendations:
            await session.execute(
                text(
                    """
                    INSERT INTO recommendations (assessment_id, text, rationale, disposition)
                    VALUES (
                        CAST(:aid AS uuid), :text, :rationale, 'proposed'
                    )
                    """
                ),
                {
                    "aid": str(assessment_id),
                    "text": rec.text,
                    "rationale": rec.rationale,
                },
            )

        await _persist_metadata(
            session,
            assessment_id,
            provider=generation.provider,
            model=generation.model,
            tokens_in=generation.input_tokens,
            tokens_out=generation.output_tokens,
            cost_usd=generation.estimated_cost_usd,
            latency_ms=generation.latency_ms,
            confidence=result.confidence,
            context_ids=context_ids,
            evidence_ids=evidence_ids,
            retrieval_mode=hybrid.mode,
            retrieval_quality=hybrid.quality,
            retrieval_score=hybrid.best_score,
            embedding_model=hybrid.embedding_model,
        )
        await session.commit()

        await transition_review(
            session,
            review_id,
            ReviewEvent.ASSESSMENT_COMPLETED,
            f"assessment:{generation.provider}",
            extra_payload={"assessment_id": str(assessment_id)},
        )

        await manager.broadcast(
            "assessment.completed",
            {
                "assessment_id": str(assessment_id),
                "review_id": str(review_id),
                "risk_level": result.risk_level,
                "retrieval_mode": hybrid.mode,
                "provider": generation.provider,
                "ts": datetime.now(timezone.utc).isoformat(),
            },
        )
        logger.info(
            "assessment %s complete (provider=%s mode=%s risk=%s)",
            assessment_id,
            generation.provider,
            hybrid.mode,
            result.risk_level,
        )
