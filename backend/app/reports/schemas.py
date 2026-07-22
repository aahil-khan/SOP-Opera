"""
Response shapes for reports.

The packet itself (`reports/packet.py`) is the *frozen* content. These models are
the read-time envelope around it: the version trail and the integrity check,
neither of which can be frozen without becoming a decoration.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.reports.packet import ReportPacket

HashStatus = Literal["match", "mismatch", "not_recorded"]


class ReportIntegrity(BaseModel):
    """
    Whether this packet still is what it was when it was frozen.

    Recomputed on every read, deliberately: an integrity claim that was itself
    frozen at write time proves nothing about the period since.
    """

    content_hash_stored: str | None = None
    content_hash_recomputed: str | None = None
    content_hash_status: HashStatus = "not_recorded"
    snapshot_hash: str | None = None
    chain_intact: bool = True
    chain_entries_checked: int = 0
    chain_breaks: list[dict] = Field(default_factory=list)
    verified_at: datetime | None = None


class ReportVersionRef(BaseModel):
    id: UUID
    closure_event_seq: int
    version_label: str
    generated_at: datetime
    is_current: bool
    outcome: str | None = None
    content_hash: str | None = None


class ReportOut(BaseModel):
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
    content: ReportPacket
    integrity: ReportIntegrity
    versions: list[ReportVersionRef] = Field(default_factory=list)


class ReportSummaryOut(BaseModel):
    """One row of the /reports register."""

    id: UUID
    review_id: UUID
    closure_event_seq: int
    version_label: str
    report_ref: str
    is_current: bool
    packet_version: int
    generated_at: datetime
    frozen_at: datetime | None = None
    closed_by: str | None = None
    title: str | None = None
    asset_name: str | None = None
    asset_zone: str | None = None
    outcome: str | None = None
    outcome_label: str | None = None
    outcome_headline: str | None = None
    summary_line: str | None = None
    risk_level: str | None = None
    decided_by_name: str | None = None
    open_tasks: int = 0
    citation_count: int = 0
    evidence_count: int = 0
    content_hash: str | None = None
