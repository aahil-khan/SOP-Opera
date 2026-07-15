"""Read-only AI Ops aggregates over assessment_metadata."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_ops.schemas import AiOpsSummary


async def get_summary(session: AsyncSession) -> AiOpsSummary:
    result = await session.execute(
        text(
            """
            SELECT
                COUNT(*) FILTER (WHERE a.assessment_type = 'ai') AS total_assessments,
                COUNT(*) FILTER (
                    WHERE a.assessment_type = 'ai' AND a.status = 'complete'
                ) AS complete_count,
                COUNT(*) FILTER (
                    WHERE a.assessment_type = 'ai' AND a.status = 'failed'
                ) AS failed_count,
                COUNT(*) FILTER (
                    WHERE a.assessment_type = 'ai'
                      AND a.status = 'failed'
                      AND m.failure_reason = 'validation'
                ) AS validation_failure_count,
                COUNT(*) FILTER (
                    WHERE a.assessment_type = 'ai'
                      AND a.status = 'failed'
                      AND m.failure_reason = 'provider_error'
                ) AS provider_error_count,
                COUNT(*) FILTER (
                    WHERE a.assessment_type = 'ai'
                      AND m.retrieval_mode = 'rag'
                ) AS rag_count,
                COUNT(*) FILTER (
                    WHERE a.assessment_type = 'ai'
                      AND m.retrieval_mode = 'deterministic'
                ) AS deterministic_count,
                COUNT(*) FILTER (
                    WHERE a.assessment_type = 'ai'
                      AND m.retrieval_mode IN ('rag', 'deterministic')
                ) AS retrieval_ran_count,
                AVG(m.retrieval_score) FILTER (
                    WHERE a.assessment_type = 'ai'
                      AND m.retrieval_mode = 'rag'
                      AND m.retrieval_score IS NOT NULL
                ) AS mean_retrieval_relevance
            FROM assessments a
            LEFT JOIN assessment_metadata m ON m.assessment_id = a.id
            """
        )
    )
    row = result.one()._mapping
    total = int(row["total_assessments"] or 0)
    complete = int(row["complete_count"] or 0)
    failed = int(row["failed_count"] or 0)
    retrieval_ran = int(row["retrieval_ran_count"] or 0)
    rag = int(row["rag_count"] or 0)
    deterministic = int(row["deterministic_count"] or 0)

    success_rate = (complete / total) if total > 0 else 0.0
    rag_hit_rate = (rag / retrieval_ran) if retrieval_ran > 0 else 0.0
    rag_fallback_rate = (
        (deterministic / retrieval_ran) if retrieval_ran > 0 else 0.0
    )
    mean_rel = row["mean_retrieval_relevance"]
    mean_retrieval_relevance = float(mean_rel) if mean_rel is not None else None

    return AiOpsSummary(
        total_assessments=total,
        complete_count=complete,
        failed_count=failed,
        success_rate=round(success_rate, 4),
        validation_failure_count=int(row["validation_failure_count"] or 0),
        provider_error_count=int(row["provider_error_count"] or 0),
        rag_hit_rate=round(rag_hit_rate, 4),
        rag_fallback_rate=round(rag_fallback_rate, 4),
        mean_retrieval_relevance=(
            round(mean_retrieval_relevance, 4)
            if mean_retrieval_relevance is not None
            else None
        ),
        retrieval_ran_count=retrieval_ran,
    )
