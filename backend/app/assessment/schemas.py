"""Assessment pipeline I/O schemas (provider output + HTTP bodies)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from shared.python.schemas import RecommendationIn, RetrievedReference, ReasoningFactor, RiskLevel


class AssessmentResult(BaseModel):
    """Structured LLM output — same schema enforced for mock / openai / ollama."""

    summary: str
    risk_level: RiskLevel
    recommendations: list[RecommendationIn] = Field(min_length=1)
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class ProviderGeneration(BaseModel):
    """AssessmentResult plus provider-side observability metrics."""

    result: AssessmentResult
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost_usd: float = 0.0
    latency_ms: int = 0


class RetryIn(BaseModel):
    provider: Literal["openai_compatible", "ollama", "mock"] | None = None


class AssessmentOut(BaseModel):
    """Response shape for GET /reviews/{id}/assessments (full history)."""

    id: str
    review_id: str
    assessment_type: str
    status: str
    risk_level: RiskLevel | None = None
    summary: str | None = None
    derived_fact_ids: list[str] = Field(default_factory=list)
    version: int
    created_at: str | None = None
    recommendations: list[dict] = Field(default_factory=list)
    retrieved_references: list[RetrievedReference] = Field(default_factory=list)
    reasoning_factors: list[ReasoningFactor] = Field(default_factory=list)
    metadata: dict | None = None
