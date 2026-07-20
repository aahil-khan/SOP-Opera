"""Append-only AI pipeline event log — survives demo reset."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def record_ai_ops_event(
    session: AsyncSession,
    *,
    assessment_id: UUID,
    review_id: UUID,
    status: str,
    provider: str,
    model: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_usd: float = 0.0,
    latency_ms: int = 0,
    retrieval_mode: str | None = None,
    retrieval_score: float | None = None,
    failure_reason: str | None = None,
    llm_attempt_count: int = 0,
    llm_fallback_count: int = 0,
    degraded: bool = False,
) -> None:
    """Persist one terminal AI assessment outcome for AI Ops aggregates."""
    if status not in ("complete", "failed"):
        return
    await session.execute(
        text(
            """
            INSERT INTO ai_ops_events (
                assessment_id, review_id, status, provider, model,
                tokens_in, tokens_out, cost_usd, latency_ms,
                retrieval_mode, retrieval_score, failure_reason,
                llm_attempt_count, llm_fallback_count, degraded
            )
            VALUES (
                CAST(:assessment_id AS uuid), CAST(:review_id AS uuid),
                :status, :provider, :model,
                :tokens_in, :tokens_out, :cost_usd, :latency_ms,
                :retrieval_mode, :retrieval_score, :failure_reason,
                :llm_attempt_count, :llm_fallback_count, :degraded
            )
            ON CONFLICT (assessment_id) DO UPDATE SET
                review_id = EXCLUDED.review_id,
                status = EXCLUDED.status,
                provider = EXCLUDED.provider,
                model = EXCLUDED.model,
                tokens_in = EXCLUDED.tokens_in,
                tokens_out = EXCLUDED.tokens_out,
                cost_usd = EXCLUDED.cost_usd,
                latency_ms = EXCLUDED.latency_ms,
                retrieval_mode = EXCLUDED.retrieval_mode,
                retrieval_score = EXCLUDED.retrieval_score,
                failure_reason = EXCLUDED.failure_reason,
                llm_attempt_count = EXCLUDED.llm_attempt_count,
                llm_fallback_count = EXCLUDED.llm_fallback_count,
                degraded = EXCLUDED.degraded,
                recorded_at = now()
            """
        ),
        {
            "assessment_id": str(assessment_id),
            "review_id": str(review_id),
            "status": status,
            "provider": provider,
            "model": model,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "cost_usd": cost_usd,
            "latency_ms": latency_ms,
            "retrieval_mode": retrieval_mode,
            "retrieval_score": retrieval_score,
            "failure_reason": failure_reason,
            "llm_attempt_count": llm_attempt_count,
            "llm_fallback_count": llm_fallback_count,
            "degraded": degraded,
        },
    )
