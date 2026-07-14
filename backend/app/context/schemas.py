from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from shared.python.schemas import Asset, Context, Decision, DerivedFact, Review


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


class EscalateIn(BaseModel):
    reason: str = ""


class ReopenIn(BaseModel):
    reason: str = ""


class ReviewDetailOut(BaseModel):
    review: Review
    asset: Asset
    context: list[Context]
    derived_facts: list[DerivedFact]
    decision: Decision | None = None
