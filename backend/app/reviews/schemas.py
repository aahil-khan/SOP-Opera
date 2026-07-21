from __future__ import annotations

# Re-export request models that live with context for routing convenience
from app.context.schemas import (  # noqa: F401
    CreateReviewIn,
    EscalateIn,
    ReopenIn,
    ReviewDetailOut,
)

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class SharedReviewOut(BaseModel):
    review_id: UUID
    asset_id: UUID
    asset_name: str
    asset_zone: str
    review_state: str
    description: str
    concern_type: str
    raised_by_name: str
    created_at: datetime
