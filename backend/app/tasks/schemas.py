from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

TaskType = Literal["follow_up", "unblock"]
TaskStatus = Literal["open", "acknowledged", "done", "cancelled"]


class TaskSummaryOut(BaseModel):
    """Aggregated HITL task status for a review (derived, not a review state)."""

    total: int = 0
    open: int = 0
    acknowledged: int = 0
    done: int = 0
    cancelled: int = 0
    all_done: bool = True


class ReviewTaskOut(BaseModel):
    """Task row embedded on review detail (operator follow-through visibility)."""

    id: UUID
    assigned_worker_id: UUID
    assigned_worker_name: str | None = None
    task_type: TaskType
    title: str
    detail: str | None
    status: TaskStatus
    created_at: str
    acknowledged_at: str | None = None
    done_at: str | None = None
    done_note: str | None = None


class TaskListOut(BaseModel):
    id: UUID
    review_id: UUID
    decision_id: UUID | None
    assigned_worker_id: UUID
    task_type: TaskType
    title: str
    detail: str | None
    status: TaskStatus
    created_by: str
    created_at: str
    acknowledged_at: str | None = None
    done_at: str | None = None
    done_note: str | None = None

    # Joined context (for supervisor backlog UI).
    review_state: str
    asset_id: UUID
    asset_name: str
    asset_zone: str
    asset_floor: str

    decision_outcome: str | None = None
    decision_conditions: str | None = None
    decision_comments: str | None = None
    decision_submitted_at: str | None = None
    decision_decided_by_name: str | None = None


class TaskAcknowledgeOut(BaseModel):
    id: UUID
    status: TaskStatus
    acknowledged_at: str


class TaskDoneIn(BaseModel):
    done_note: str = Field(default="", description="Resolution note (human action / evidence).")


class TaskDoneOut(BaseModel):
    id: UUID
    status: TaskStatus
    done_at: str
    done_note: str | None = None

