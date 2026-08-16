from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ProviderConnectionOut(BaseModel):
    provider: str
    model: str | None = None
    ok: bool
    status: str
    reason: str | None = None


class ProviderComparisonRow(BaseModel):
    provider: str
    model: str | None = None
    status: str
    connection_status: str
    connection_ok: bool
    note: str | None = None
    assessment_count: int = 0
    complete_count: int = 0
    failed_count: int = 0
    mean_latency_ms: float | None = None
    p50_latency_ms: float | None = None
    p95_latency_ms: float | None = None
    total_tokens: int | None = None
    mean_tokens: float | None = None
    total_cost_usd: float | None = None
    mean_cost_usd: float | None = None
    failure_rate: float | None = None


class AiOpsSummary(BaseModel):
    data_source: Literal["local_db"] = "local_db"
    persists_across_demo_reset: bool = True
    total_assessments: int = 0
    complete_count: int = 0
    failed_count: int = 0
    success_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    validation_failure_count: int = 0
    provider_error_count: int = 0
    # Assessment health: completed runs where an agent call fell back to a
    # template. Prefixed `llm_` to keep it distinct from the sensor-coverage
    # `degraded_channel_count` below — same word, unrelated concept, and both
    # render on the AI Ops page.
    llm_degraded_count: int = 0
    llm_fallback_count: int = 0
    llm_attempt_count: int = 0
    llm_fallback_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    llm_degraded_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    rag_hit_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    rag_fallback_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    mean_retrieval_relevance: float | None = None
    retrieval_ran_count: int = 0
    # Agent-path spend / latency (from ai_ops_events append log)
    mean_latency_ms: float | None = None
    # Percentiles over the same sample. The mean is kept; p50/p95 are what a
    # control room feels — see app/core/stats.py.
    p50_latency_ms: float | None = None
    p95_latency_ms: float | None = None
    latency_sample_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    mean_cost_usd: float | None = None
    # LangSmith deep-link
    # Realtime backpressure — a live ceiling a judge can watch move.
    ws_clients: int = 0
    ws_queue_depth_max: int = 0
    ws_queue_capacity: int = 0
    ws_dropped_frames: int = 0

    langsmith_enabled: bool = False
    langsmith_project: str = "sop-opera"
    langsmith_url: str | None = None

    # W3a sensor coverage — live channel health across all assets.
    blind_channel_count: int = 0
    degraded_channel_count: int = 0
    asset_count: int = 0

    # Last retrieval quality-gate trace (from assessment_metadata) — the W5
    # demo beat: what vector search scored and why the mode won.
    last_retrieval_mode: str | None = None
    last_retrieval_quality: str | None = None
    last_retrieval_score: float | None = None
    last_retrieval_embedding_model: str | None = None
    rag_gate_threshold: float | None = None
    providers: list[ProviderComparisonRow] = Field(default_factory=list)


class ProviderStateOut(BaseModel):
    """Effective AI provider selection for subsequent assessments."""

    active_provider: str
    active_model: str | None = None
    source: Literal["runtime_override", "env_default", "auto_default"]
    env_default: str
    configured_default: str | None = None
    connection: ProviderConnectionOut
    fallback_reason: str | None = None
    available: list[str]
    scope: str = (
        "Applies to assessments enqueued by this API process from now on; "
        "runtime overrides reset on restart. Without an explicit provider, "
        "automatic selection tries Ollama, then OpenAI-compatible, then mock."
    )


class ProviderStateIn(BaseModel):
    """Set (or clear with null) the runtime default provider."""

    provider: str | None = None


class AiOpsEventOut(BaseModel):
    """One terminal assessment outcome from the append-only ai_ops_events log."""

    assessment_id: str
    review_id: str
    status: str
    provider: str
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    retrieval_mode: str | None = None
    retrieval_score: float | None = None
    failure_reason: str | None = None
    degraded: bool = False
    recorded_at: str
