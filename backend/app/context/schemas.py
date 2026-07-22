from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.tasks.schemas import ReviewTaskOut, TaskSummaryOut
from shared.python.schemas import AreaOwner, Asset, Context, Decision, DerivedFact, Review

SupervisorConcernType = Literal[
    "safety_hazard",
    "equipment",
    "permit_isolation",
    "environmental",
    "personnel",
    "other",
]


class SupervisorReportOut(BaseModel):
    description: str
    concern_type: SupervisorConcernType
    reported_by_name: str


class ContextIn(BaseModel):
    asset_id: UUID
    category: str
    payload: dict[str, Any]
    provider: str = "manual"
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ContextIngestResult(BaseModel):
    context: Context
    derived_facts: list[DerivedFact]
    review: Review | None


class CreateReviewIn(BaseModel):
    asset_id: UUID
    triggered_by: str = "manual_request"
    owner_id: UUID | None = None
    # HITL: optional supervisor free-text issue report.
    description: str | None = None
    raised_by_worker_id: UUID | None = None
    tagged_worker_ids: list[UUID] = Field(default_factory=list)
    concern_type: SupervisorConcernType = "other"


class ReopenIn(BaseModel):
    reason: str = ""


class ReviewDetailOut(BaseModel):
    review: Review
    asset: Asset
    context: list[Context]
    derived_facts: list[DerivedFact]
    decision: Decision | None = None
    decided_by_name: str | None = None
    area_owner: AreaOwner | None = None
    raised_by_worker_name: str | None = None
    supervisor_report: SupervisorReportOut | None = None
    task_summary: TaskSummaryOut | None = None
    tasks: list[ReviewTaskOut] = Field(default_factory=list)
