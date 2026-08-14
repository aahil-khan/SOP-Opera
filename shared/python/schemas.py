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
    source_url: str | None = None
    """Primary-source link, so a cited clause can be checked rather than trusted."""
    occurred_at: datetime | None = None
    """When a matched historical incident occurred (drives the 'N months ago' echo)."""


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
    """
    Envelope around a frozen closure packet.

    The packet's own shape is defined once, in `backend/app/reports/packet.py`
    (`ReportPacket`), and mirrored in `shared/schemas.ts`. It is left as a dict
    here rather than duplicated a third time — the backend already validates it
    on the way in and on the way out.
    """

    id: UUID
    review_id: UUID
    closure_event_seq: int
    version_label: str
    is_current: bool
    packet_version: int
    supersedes_report_id: UUID | None = None
    superseded_by_report_id: UUID | None = None
    generated_at: datetime
    frozen_at: datetime | None = None
    closed_by: str | None = None
    content_hash: str | None = None
    content: dict[str, Any]
    integrity: dict[str, Any] = {}
    versions: list[dict[str, Any]] = []


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


# --- Shift handover ---------------------------------------------------------
#
# Mirrors the TypeScript in shared/schemas.ts. These two files are hand-kept in
# sync, not generated. The endpoint-level shapes live in
# backend/app/handover/schemas.py; these are the contract types.

HandoverState = Literal["draft", "issued", "accepted", "expired"]
HandoverItemType = Literal[
    "open_review", "active_fact", "open_task", "decision_condition", "note"
]
HandoverAckState = Literal["pending", "acknowledged", "queried"]
HandoverNarrationMode = Literal["llm", "deterministic", "fallback"]


class HandoverItem(BaseModel):
    id: UUID
    item_type: HandoverItemType
    position: int
    review_id: UUID | None = None
    asset_id: UUID | None = None
    asset_name: str | None = None
    task_id: UUID | None = None
    title: str
    detail: str | None = None
    risk_level: str
    hazard_dimensions: list[str] = Field(default_factory=list)
    requires_ack: bool
    ack_state: HandoverAckState
    ack_note: str | None = None
    acknowledged_by: UUID | None = None
    acknowledged_by_name: str | None = None
    acknowledged_at: datetime | None = None
    source: Literal["auto", "manual"]


class Handover(BaseModel):
    id: UUID
    state: HandoverState
    outgoing_actor_id: UUID
    outgoing_actor_name: str
    incoming_actor_id: UUID
    incoming_actor_name: str
    window_start: datetime
    window_end: datetime
    brief: str | None = None
    narration_mode: HandoverNarrationMode
    issued_at: datetime | None = None
    accepted_at: datetime | None = None
    created_at: datetime
    items: list[HandoverItem] = Field(default_factory=list)
    required_total: int = 0
    required_cleared: int = 0
    attention_asset_id: UUID | None = None
    viewer_role: Literal["outgoing", "incoming", "observer"] = "observer"
