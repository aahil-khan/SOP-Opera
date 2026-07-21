from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AiOpsSummary(BaseModel):
    data_source: Literal["local_db"] = "local_db"
    persists_across_demo_reset: bool = True
    total_assessments: int = 0
    complete_count: int = 0
    failed_count: int = 0
    success_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    validation_failure_count: int = 0
    provider_error_count: int = 0
    degraded_count: int = 0
    llm_fallback_count: int = 0
    llm_attempt_count: int = 0
    llm_fallback_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    degraded_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    rag_hit_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    rag_fallback_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    mean_retrieval_relevance: float | None = None
    retrieval_ran_count: int = 0
    # Agent-path spend / latency (from ai_ops_events append log)
    mean_latency_ms: float | None = None
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
