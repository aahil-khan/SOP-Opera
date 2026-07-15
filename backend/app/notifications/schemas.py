from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: UUID
    review_id: UUID | None
    event_type: str
    summary: str
    recipient_ids: list[UUID]
    created_at: datetime
