"""Shift-handover request/response shapes."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

HandoverState = Literal["draft", "issued", "accepted", "expired"]
HandoverItemType = Literal[
    "open_review", "active_fact", "open_task", "decision_condition", "note"
]
AckState = Literal["pending", "acknowledged", "queried"]
NarrationMode = Literal["llm", "deterministic", "fallback"]


class HandoverItemOut(BaseModel):
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
    ack_state: AckState
    ack_note: str | None = None
    acknowledged_by: UUID | None = None
    acknowledged_by_name: str | None = None
    acknowledged_at: datetime | None = None
    source: Literal["auto", "manual"]


class HandoverOut(BaseModel):
    id: UUID
    state: HandoverState
    outgoing_actor_id: UUID
    outgoing_actor_name: str
    incoming_actor_id: UUID
    incoming_actor_name: str
    window_start: datetime
    window_end: datetime
    brief: str | None = None
    narration_mode: NarrationMode
    issued_at: datetime | None = None
    accepted_at: datetime | None = None
    created_at: datetime
    items: list[HandoverItemOut] = Field(default_factory=list)
    required_total: int = 0
    required_cleared: int = 0
    #: The asset the incoming operator should look at first — highest-risk
    #: unacknowledged item, else the highest-risk item.
    attention_asset_id: UUID | None = None
    #: Which side of this handover the requesting actor is on. `observer` covers
    #: the supervisor, who can read a handover but is never a party to one.
    viewer_role: Literal["outgoing", "incoming", "observer"] = "observer"


class HandoverDraftIn(BaseModel):
    incoming_actor_id: UUID
    window_hours: int = Field(default=12, ge=1, le=72)


class HandoverNoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    detail: str | None = None
    requires_ack: bool = True


class HandoverAckIn(BaseModel):
    ack_state: Literal["acknowledged", "queried"] = "acknowledged"
    note: str | None = None


class HandoverGapOut(BaseModel):
    """A high-risk item that crossed a boundary without being acknowledged."""

    handover_id: UUID
    item_id: UUID
    asset_id: UUID | None = None
    asset_name: str | None = None
    title: str
    risk_level: str
    incoming_actor_name: str
    issued_at: datetime | None = None
    hours_outstanding: float


class HandoverMetricsOut(BaseModel):
    handovers_total: int
    handovers_accepted: int
    required_items_total: int
    required_items_cleared: int
    #: Share of high-risk carried items the incoming operator actually
    #: acknowledged. This is an operational measure of the handover process; it
    #: is deliberately not a detector input (see eval/detectors.py).
    coverage_pct: float
    median_ack_minutes: float | None = None
    unacknowledged_crossings: int = 0
