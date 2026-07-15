from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class ReportOut(BaseModel):
    id: UUID
    review_id: UUID
    closure_event_seq: int
    content: dict[str, Any]
    generated_at: datetime


class ReportSummary(BaseModel):
    id: UUID
    review_id: UUID
    closure_event_seq: int
    generated_at: datetime
    title: str | None = None
    asset_name: str | None = None
    outcome: str | None = None
    risk_level: str | None = None
