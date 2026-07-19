from __future__ import annotations

from pydantic import BaseModel, Field


class AiOpsSummary(BaseModel):
    total_assessments: int = 0
    complete_count: int = 0
    failed_count: int = 0
    success_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    validation_failure_count: int = 0
    provider_error_count: int = 0
    rag_hit_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    rag_fallback_rate: float = Field(ge=0.0, le=1.0, default=0.0)
    mean_retrieval_relevance: float | None = None
    retrieval_ran_count: int = 0
    # Agent-path spend / latency (from assessment_metadata; real usage when recorded)
    mean_latency_ms: float | None = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    mean_cost_usd: float | None = None
    # LangSmith deep-link
    langsmith_enabled: bool = False
    langsmith_project: str = "sop-opera"
    langsmith_url: str | None = None
