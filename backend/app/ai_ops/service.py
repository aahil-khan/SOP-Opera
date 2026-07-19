"""Read-only AI Ops aggregates over assessment_metadata."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_ops.schemas import AiOpsSummary
from app.core.config import get_settings


def _langsmith_fields() -> tuple[bool, str, str | None]:
    settings = get_settings()
    enabled = bool(settings.langchain_tracing_v2 and settings.langchain_api_key)
    project = settings.langchain_project or "sop-opera"
    if not enabled:
        return False, project, None
    url = (settings.langsmith_project_url or "").strip() or "https://smith.langchain.com"
    return True, project, url


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
                ) AS mean_retrieval_relevance,
                AVG(m.latency_ms) FILTER (
                    WHERE a.assessment_type = 'ai'
                      AND a.status = 'complete'
                      AND m.latency_ms IS NOT NULL
                ) AS mean_latency_ms,
                COALESCE(
                    SUM(m.tokens_in) FILTER (
                        WHERE a.assessment_type = 'ai' AND a.status = 'complete'
                    ),
                    0
                ) AS total_input_tokens,
                COALESCE(
                    SUM(m.tokens_out) FILTER (
                        WHERE a.assessment_type = 'ai' AND a.status = 'complete'
                    ),
                    0
                ) AS total_output_tokens,
                COALESCE(
                    SUM(m.cost_usd) FILTER (
                        WHERE a.assessment_type = 'ai' AND a.status = 'complete'
                    ),
                    0
                ) AS total_cost_usd,
                AVG(m.cost_usd) FILTER (
                    WHERE a.assessment_type = 'ai'
                      AND a.status = 'complete'
                      AND m.cost_usd IS NOT NULL
                ) AS mean_cost_usd
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
    mean_lat = row["mean_latency_ms"]
    mean_latency_ms = float(mean_lat) if mean_lat is not None else None
    mean_cost = row["mean_cost_usd"]
    mean_cost_usd = float(mean_cost) if mean_cost is not None else None

    langsmith_enabled, langsmith_project, langsmith_url = _langsmith_fields()

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
        mean_latency_ms=(
            round(mean_latency_ms, 2) if mean_latency_ms is not None else None
        ),
        total_input_tokens=int(row["total_input_tokens"] or 0),
        total_output_tokens=int(row["total_output_tokens"] or 0),
        total_cost_usd=round(float(row["total_cost_usd"] or 0.0), 8),
        mean_cost_usd=(
            round(mean_cost_usd, 8) if mean_cost_usd is not None else None
        ),
        langsmith_enabled=langsmith_enabled,
        langsmith_project=langsmith_project,
        langsmith_url=langsmith_url,
    )
