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
