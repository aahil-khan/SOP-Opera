"""Canonical Python mirrors of shared/ TypeScript contracts (TDS §8)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

ReviewState = Literal[
    "opened",
    "assessing",
    "pending_decision",
    "decided",
    "escalated",
    "closed",
    "reopened",
]
AssessmentType = Literal["ai", "manual"]
AssessmentStatus = Literal[
    "pending", "generating", "complete", "failed", "superseded"
]
RiskLevel = Literal["nominal", "elevated", "blocking"]
DecisionOutcome = Literal["approved", "approved_with_conditions", "blocked"]
ReviewOrigin = Literal["system", "operator", "supervisor"]
ReferenceSource = Literal["regulations", "historical_incidents", "sops"]
RetrievalPath = Literal["rag", "deterministic"]
RetrievalMode = Literal["rag", "deterministic", "skipped"]
RetrievalQuality = Literal["good", "weak", "empty", "n_a"]


class Context(BaseModel):
    id: UUID
    asset_id: UUID
    category: str
    payload: dict[str, Any]
    provider: str
    valid_from: datetime
    valid_until: datetime
    confidence: float


class DerivedFact(BaseModel):
    id: UUID
    asset_id: UUID
    fact_type: str
    value: bool | float | str
    computed_at: datetime
    source_context_ids: list[UUID]


class RetrievedReference(BaseModel):
    source: ReferenceSource
    id: UUID
    retrieval_path: RetrievalPath
    score: float | None = None
    chunk_id: UUID | None = None
    title: str | None = None
    snippet: str | None = None
    code: str | None = None
    triggered_by_fact: str | None = None


class ReasoningFactor(BaseModel):
    fact_type: str
    headline: str
    detail: str
    evidence: list[RetrievedReference] = Field(default_factory=list)
    context_ids: list[UUID] = Field(default_factory=list)


class AreaOwner(BaseModel):
    worker_id: UUID
    name: str
    role: str
    zone: str


class Recommendation(BaseModel):
    id: UUID
    text: str
    rationale: str
    disposition: Literal["proposed", "accepted", "rejected"] | None = None


class RecommendationIn(BaseModel):
    text: str
    rationale: str


class ManualAssessmentIn(BaseModel):
    summary: str
    risk_level: RiskLevel
    recommendations: list[RecommendationIn]


class AssessmentMetadata(BaseModel):
    provider: str
    model: str
    prompt_version: str
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float
    latency_ms: int
    timestamp: datetime
    retrieved_context_ids: list[UUID]
    retrieved_evidence_ids: list[UUID]
    retrieval_mode: RetrievalMode
    retrieval_quality: RetrievalQuality
    retrieval_score: float | None = None
    embedding_model: str | None = None
    confidence: float
    assessment_version: int
    reasoning_factors: list[ReasoningFactor] = Field(default_factory=list)


class Assessment(BaseModel):
    id: UUID
    review_id: UUID
    assessment_type: AssessmentType
    status: AssessmentStatus
    risk_level: RiskLevel
    summary: str
    recommendations: list[Recommendation]
    derived_fact_ids: list[UUID]
    metadata: AssessmentMetadata | None = None
    reasoning_factors: list[ReasoningFactor] = Field(default_factory=list)


class Decision(BaseModel):
    id: UUID
    review_id: UUID
    assessment_id: UUID
    decided_by: UUID
    outcome: DecisionOutcome
    recommendation_dispositions: dict[UUID, Literal["accepted", "rejected"]]
    conditions: str | None = None
    comments: str | None = None
    submitted_at: datetime


class Review(BaseModel):
    id: UUID
    asset_id: UUID
    state: ReviewState
    owner_id: UUID
    triggered_by: str
    origin: ReviewOrigin = "system"
    raised_by_worker_id: UUID | None = None
    created_at: datetime


class Asset(BaseModel):
    id: UUID
    name: str
    zone: str
    plant_id: str
    floor: Literal["ground", "first", "second"] = "ground"


class Report(BaseModel):
    id: UUID
    review_id: UUID
    closure_event_seq: int
    content: dict[str, Any]
    generated_at: datetime


class Notification(BaseModel):
    id: UUID
    review_id: UUID | None
    event_type: str
    summary: str
    recipient_ids: list[UUID]
    created_at: datetime


class PingResponse(BaseModel):
    ok: Literal[True] = True
    service: str = "sop-opera-api"
    message: str = Field(default="pong")
