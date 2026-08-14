"""Read-only AI Ops aggregates over the append-only ai_ops_events log."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_ops.schemas import AiOpsEventOut, AiOpsSummary
from app.core.config import get_settings
from app.core.stats import LatencySummary

LATENCY_SAMPLE_WINDOW = 500
"""Most recent completed assessments the latency percentiles are computed over."""


async def list_recent_events(
    session: AsyncSession, *, limit: int = 20
) -> list[AiOpsEventOut]:
    """Most recent terminal assessment outcomes, newest first."""
    result = await session.execute(
        text(
            """
            SELECT assessment_id, review_id, status, provider, model,
                   tokens_in, tokens_out, cost_usd, latency_ms,
                   retrieval_mode, retrieval_score, failure_reason,
                   degraded, recorded_at
            FROM ai_ops_events
            ORDER BY recorded_at DESC
            LIMIT :limit
            """
        ),
        {"limit": max(1, min(int(limit), 100))},
    )
    events: list[AiOpsEventOut] = []
    for row in result.fetchall():
        m = row._mapping
        events.append(
            AiOpsEventOut(
                assessment_id=str(m["assessment_id"]),
                review_id=str(m["review_id"]),
                status=m["status"],
                provider=m["provider"],
                model=m["model"],
                tokens_in=int(m["tokens_in"] or 0),
                tokens_out=int(m["tokens_out"] or 0),
                cost_usd=float(m["cost_usd"] or 0.0),
                latency_ms=int(m["latency_ms"] or 0),
                retrieval_mode=m["retrieval_mode"],
                retrieval_score=(
                    float(m["retrieval_score"])
                    if m["retrieval_score"] is not None
                    else None
                ),
                failure_reason=m["failure_reason"],
                degraded=bool(m["degraded"]),
                recorded_at=(
                    m["recorded_at"].isoformat()
                    if hasattr(m["recorded_at"], "isoformat")
                    else str(m["recorded_at"])
                ),
            )
        )
    return events


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
                COUNT(*) AS total_assessments,
                COUNT(*) FILTER (WHERE status = 'complete') AS complete_count,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
                COUNT(*) FILTER (
                    WHERE status = 'failed' AND failure_reason = 'validation'
                ) AS validation_failure_count,
                COUNT(*) FILTER (
                    WHERE status = 'failed' AND failure_reason = 'provider_error'
                ) AS provider_error_count,
                COUNT(*) FILTER (
                    WHERE status = 'complete' AND degraded = TRUE
                ) AS degraded_count,
                COALESCE(SUM(llm_fallback_count), 0) AS llm_fallback_count,
                COALESCE(SUM(llm_attempt_count), 0) AS llm_attempt_count,
                COUNT(*) FILTER (WHERE retrieval_mode = 'rag') AS rag_count,
                COUNT(*) FILTER (
                    WHERE retrieval_mode = 'deterministic'
                ) AS deterministic_count,
                COUNT(*) FILTER (
                    WHERE retrieval_mode IN ('rag', 'deterministic')
                ) AS retrieval_ran_count,
                AVG(retrieval_score) FILTER (
                    WHERE retrieval_mode = 'rag' AND retrieval_score IS NOT NULL
                ) AS mean_retrieval_relevance,
                AVG(latency_ms) FILTER (
                    WHERE status = 'complete' AND latency_ms IS NOT NULL
                ) AS mean_latency_ms,
                COALESCE(
                    SUM(tokens_in) FILTER (WHERE status = 'complete'),
                    0
                ) AS total_input_tokens,
                COALESCE(
                    SUM(tokens_out) FILTER (WHERE status = 'complete'),
                    0
                ) AS total_output_tokens,
                COALESCE(
                    SUM(cost_usd) FILTER (WHERE status = 'complete'),
                    0
                ) AS total_cost_usd,
                AVG(cost_usd) FILTER (
                    WHERE status = 'complete' AND cost_usd IS NOT NULL
                ) AS mean_cost_usd
            FROM ai_ops_events
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
    llm_attempt_total = int(row["llm_attempt_count"] or 0)
    llm_fallback_total = int(row["llm_fallback_count"] or 0)
    llm_fallback_rate = (
        (llm_fallback_total / llm_attempt_total) if llm_attempt_total > 0 else 0.0
    )
    degraded_count = int(row["degraded_count"] or 0)
    degraded_rate = (degraded_count / complete) if complete > 0 else 0.0
    mean_rel = row["mean_retrieval_relevance"]
    mean_retrieval_relevance = float(mean_rel) if mean_rel is not None else None
    mean_lat = row["mean_latency_ms"]
    mean_latency_ms = float(mean_lat) if mean_lat is not None else None
    mean_cost = row["mean_cost_usd"]
    mean_cost_usd = float(mean_cost) if mean_cost is not None else None

    # Latency percentiles come from the raw sample rather than SQL so the bench
    # harness and the page report the same numbers from the same code path
    # (app/core/stats.py). Bounded window keeps this cheap as the log grows.
    lat_rows = await session.execute(
        text(
            """
            SELECT latency_ms
            FROM ai_ops_events
            WHERE status = 'complete' AND latency_ms IS NOT NULL
            ORDER BY recorded_at DESC
            LIMIT :window
            """
        ),
        {"window": LATENCY_SAMPLE_WINDOW},
    )
    latency_summary = LatencySummary(r[0] for r in lat_rows.fetchall())

    langsmith_enabled, langsmith_project, langsmith_url = _langsmith_fields()

    last_ret = await session.execute(
        text(
            """
            SELECT am.retrieval_mode, am.retrieval_quality, am.retrieval_score,
                   am.embedding_model
            FROM assessment_metadata am
            JOIN assessments a ON a.id = am.assessment_id
            WHERE am.retrieval_mode IS NOT NULL
            ORDER BY a.created_at DESC
            LIMIT 1
            """
        )
    )
    last_ret_row = last_ret.first()
    lr = last_ret_row._mapping if last_ret_row is not None else None

    from app.context.coverage import coverage_for_assets

    coverage = await coverage_for_assets(session)
    blind_count = sum(1 for c in coverage if c.coverage == "blind")
    degraded_count_cov = sum(1 for c in coverage if c.coverage == "degraded")

    return AiOpsSummary(
        blind_channel_count=blind_count,
        degraded_channel_count=degraded_count_cov,
        asset_count=len(coverage),
        last_retrieval_mode=(lr["retrieval_mode"] if lr else None),
        last_retrieval_quality=(lr["retrieval_quality"] if lr else None),
        last_retrieval_score=(
            float(lr["retrieval_score"])
            if lr and lr["retrieval_score"] is not None
            else None
        ),
        last_retrieval_embedding_model=(lr["embedding_model"] if lr else None),
        rag_gate_threshold=float(get_settings().rag_score_threshold),
        data_source="local_db",
        persists_across_demo_reset=True,
        total_assessments=total,
        complete_count=complete,
        failed_count=failed,
        success_rate=round(success_rate, 4),
        validation_failure_count=int(row["validation_failure_count"] or 0),
        provider_error_count=int(row["provider_error_count"] or 0),
        degraded_count=degraded_count,
        llm_fallback_count=llm_fallback_total,
        llm_attempt_count=llm_attempt_total,
        llm_fallback_rate=round(llm_fallback_rate, 4),
        degraded_rate=round(degraded_rate, 4),
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
        p50_latency_ms=(
            round(latency_summary.p50_ms, 2)
            if latency_summary.p50_ms is not None
            else None
        ),
        p95_latency_ms=(
            round(latency_summary.p95_ms, 2)
            if latency_summary.p95_ms is not None
            else None
        ),
        latency_sample_count=latency_summary.count,
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
