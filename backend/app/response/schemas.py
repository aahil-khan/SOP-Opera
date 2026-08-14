"""Endpoint shapes for the response domain."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class DeviceOut(BaseModel):
    id: UUID
    asset_id: UUID | None = None
    zone: str
    kind: str
    label: str
    state: str
    default_state: str
    fail_safe_state: str
    controllable: bool = True
    # Surfaced so the UI can label it rather than hardcoding "simulated".
    simulated: bool = True
    updated_at: datetime | None = None


class PageOut(BaseModel):
    id: UUID
    action_id: UUID
    role: str
    zone: str
    channel: str
    escalation_order: int
    status: str
    dispatched_at: datetime
    acknowledged_at: datetime | None = None
    acknowledged_by: str | None = None
    escalated_from_id: UUID | None = None
    simulated: bool = True


class ActionOut(BaseModel):
    id: UUID
    review_id: UUID
    asset_id: UUID | None = None
    asset_name: str | None = None
    tier: int
    action_kind: str
    label: str
    status: str
    device_id: UUID | None = None
    device_label: str | None = None
    device_zone: str | None = None
    device_kind: str | None = None
    device_state: str | None = None
    target_ref: str | None = None
    envelope: dict[str, Any] = Field(default_factory=dict)
    refusal_reason: str | None = None
    actor: str
    armed_at: datetime | None = None
    execute_after: datetime | None = None
    executed_at: datetime | None = None
    aborted_at: datetime | None = None
    revoked_at: datetime | None = None
    revoked_by: str | None = None
    revoke_reason: str | None = None
    created_at: datetime
    pages: list[PageOut] = Field(default_factory=list)
    simulated: bool = True


class RevokeIn(BaseModel):
    reason: str | None = None


class ResponseConfigOut(BaseModel):
    auto_enabled: bool
    arm_window_seconds: int
    page_ack_timeout_seconds: int
    dispatcher: dict[str, Any] = Field(default_factory=dict)


class ResponseConfigIn(BaseModel):
    auto_enabled: bool
