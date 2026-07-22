"""
Closure reports — one immutable, versioned audit packet per close event.

Freeze rule: a report is frozen at `closed` and never mutated afterwards.
Reopening a closed review does not touch its report; the next close mints a new
version that *supersedes* the previous one. `is_current` is derived from the
highest sequence number per review rather than stored, so superseding v1 never
writes to v1.

The packet is now written inside the closing transaction (see
`reviews/repository.py::transition_review`). Previously the close committed first
and report generation ran afterwards in its own transaction, so a failure in
between left a `closed` review with no report and nothing to retry it. Doing both
in one unit of work makes the failure mode "the close did not happen", which the
operator can simply repeat.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Mapping
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit, verify_audit_chain
from app.realtime.connection_manager import manager
from app.reports import repository as repo
from app.reports.packet import (
    PACKET_VERSION,
    ReportPacket,
    build_packet,
    hydrate_packet,
    normalize_content,
    packet_hash,
    report_ref,
    version_label,
)
from app.reports.schemas import (
    ReportIntegrity,
    ReportOut,
    ReportSummaryOut,
    ReportVersionRef,
)

logger = logging.getLogger(__name__)


class ReportGenerationError(RuntimeError):
    """Raised when a closure report cannot be frozen."""


async def freeze_report_on_closure(
    session: AsyncSession, review, *, actor: str
) -> tuple[UUID, int, UUID | None]:
    """
    Build and persist the frozen packet for one closure.

    Does not commit and does not broadcast — the caller owns both, so that the
    state change and the report land atomically and no client is told about a
    report that was rolled back.

    Returns (report_id, closure_event_seq, promoted_incident_id). The incident
    id is set when the closure was elevated enough to enter the historical
    corpus; the caller indexes the knowledge chunk after commit.
    """
    closure_event_seq = await repo.next_closure_seq(session, review.id)
    supersedes = await repo.latest_report_id(session, review.id)
    frozen_at = datetime.now(timezone.utc)

    packet: ReportPacket = await build_packet(
        session,
        review,
        actor=actor,
        closure_event_seq=closure_event_seq,
        supersedes_report_id=supersedes,
        frozen_at=frozen_at,
    )

    content = normalize_content(packet.model_dump(mode="json"))
    content_hash = packet_hash(content)

    try:
        report_id = await repo.insert_report(
            session,
            review_id=review.id,
            closure_event_seq=closure_event_seq,
            content=content,
            content_hash=content_hash,
            packet_version=PACKET_VERSION,
            supersedes_report_id=supersedes,
            closed_by=actor,
            frozen_at=frozen_at,
            evidence_id=UUID(packet.meta.evidence_id) if packet.meta.evidence_id else None,
            snapshot_hash=packet.meta.snapshot_hash,
        )
    except Exception as exc:  # pragma: no cover - surfaced as a 500 by the route
        raise ReportGenerationError(
            f"Could not freeze closure report for review {review.id}: {exc}"
        ) from exc

    from app.incidents.service import promote_closure_to_incident

    promoted_incident_id = await promote_closure_to_incident(
        session, review=review, packet=packet, report_id=report_id
    )

    await record_audit(
        session,
        entity_type="report",
        entity_id=report_id,
        event_type="report.generated",
        actor=actor,
        payload={
            "review_id": str(review.id),
            "closure_event_seq": closure_event_seq,
            "outcome": packet.decision.outcome if packet.decision else None,
            "content_hash": content_hash,
            "supersedes_report_id": str(supersedes) if supersedes else None,
            "built_from": packet.meta.built_from,
            "promoted_incident_id": (
                str(promoted_incident_id) if promoted_incident_id else None
            ),
        },
    )

    from app.notifications.service import notify_review_closed

    await notify_review_closed(session, review_id=review.id, owner_id=review.owner_id)

    logger.info(
        "report %s frozen for review %s (seq=%d, built_from=%s)",
        report_id,
        review.id,
        closure_event_seq,
        packet.meta.built_from,
    )
    return report_id, closure_event_seq, promoted_incident_id


async def broadcast_report_generated(
    *, report_id: UUID, review_id: UUID, closure_event_seq: int
) -> None:
    await manager.broadcast(
        "report.generated",
        {
            "report_id": str(report_id),
            "review_id": str(review_id),
            "closure_event_seq": closure_event_seq,
        },
    )


# --------------------------------------------------------------------------
# Reads
# --------------------------------------------------------------------------

def _content_of(row: Mapping) -> dict:
    raw = row.get("content")
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return raw or {}


def _version_refs(rows: list[dict[str, Any]]) -> list[ReportVersionRef]:
    return [
        ReportVersionRef(
            id=r["id"],
            closure_event_seq=int(r["closure_event_seq"]),
            version_label=version_label(int(r["closure_event_seq"])),
            generated_at=r["generated_at"],
            is_current=bool(r.get("is_current")),
            outcome=((_content_of(r).get("decision") or {}) or {}).get("outcome"),
            content_hash=r.get("content_hash"),
        )
        for r in rows
    ]


async def get_report(session: AsyncSession, report_id: UUID) -> ReportOut | None:
    row = await repo.select_report(session, report_id)
    if row is None:
        return None

    raw = _content_of(row)
    packet = hydrate_packet(raw, row=row)
    versions_rows = await repo.select_versions_for_review(session, row["review_id"])
    versions = _version_refs(versions_rows)

    # The successor is derived, never stored: writing a `superseded_by` back onto
    # v1 would mean mutating an already-frozen row.
    seq = int(row["closure_event_seq"])
    successor = next(
        (v.id for v in versions if v.closure_event_seq == seq + 1),
        None,
    )

    stored_hash = row.get("content_hash")
    recomputed = packet_hash(raw) if stored_hash else None
    if not stored_hash:
        status = "not_recorded"
    elif recomputed == stored_hash:
        status = "match"
    else:
        status = "mismatch"

    chain = await verify_audit_chain(session, entity_id=row["review_id"])
    chain_dict = chain.as_dict()

    return ReportOut(
        id=row["id"],
        review_id=row["review_id"],
        closure_event_seq=seq,
        version_label=version_label(seq),
        is_current=bool(row.get("is_current")),
        packet_version=int(row.get("packet_version") or 1),
        supersedes_report_id=row.get("supersedes_report_id"),
        superseded_by_report_id=successor,
        generated_at=row["generated_at"],
        frozen_at=row.get("frozen_at"),
        closed_by=row.get("closed_by"),
        content_hash=stored_hash,
        content=packet,
        integrity=ReportIntegrity(
            content_hash_stored=stored_hash,
            content_hash_recomputed=recomputed,
            content_hash_status=status,  # type: ignore[arg-type]
            snapshot_hash=row.get("snapshot_hash"),
            chain_intact=bool(chain_dict.get("intact")),
            chain_entries_checked=int(chain_dict.get("entries_checked") or 0),
            chain_breaks=list(chain_dict.get("breaks") or []),
            verified_at=datetime.now(timezone.utc),
        ),
        versions=versions,
    )


_SUMMARY_LINE_MAX = 120


def _truncate_summary_line(text: str, *, max_len: int = _SUMMARY_LINE_MAX) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "…"


def _to_summary(row: Mapping) -> ReportSummaryOut:
    content = _content_of(row)
    seq = int(row["closure_event_seq"])
    review_id = row["review_id"]

    # v2 shape first; fall back to the v1 keys so old rows still list.
    header = content.get("header") or {}
    asset = header.get("asset") or content.get("asset") or {}
    decision = content.get("decision") or {}
    assessment = content.get("assessment") or content.get("assessment_snapshot") or {}
    evidence = content.get("evidence") or {}
    citations = content.get("citations") or {}
    tasks = content.get("tasks") or {}
    decided_by = decision.get("decided_by") or {}

    title = header.get("title") or content.get("title")
    outcome_headline = header.get("outcome_headline")
    assessment_summary = (assessment.get("summary") or "").strip()
    summary_line = (
        _truncate_summary_line(assessment_summary)
        if assessment_summary
        else (outcome_headline or title)
    )

    return ReportSummaryOut(
        id=row["id"],
        review_id=review_id,
        closure_event_seq=seq,
        version_label=version_label(seq),
        report_ref=(content.get("meta") or {}).get("report_ref")
        or report_ref(review_id, seq),
        is_current=bool(row.get("is_current")),
        packet_version=int(row.get("packet_version") or 1),
        generated_at=row["generated_at"],
        frozen_at=row.get("frozen_at"),
        closed_by=row.get("closed_by"),
        title=title,
        asset_name=asset.get("name"),
        asset_zone=asset.get("zone"),
        outcome=decision.get("outcome"),
        outcome_label=decision.get("outcome_label"),
        outcome_headline=outcome_headline,
        summary_line=summary_line,
        risk_level=assessment.get("risk_level"),
        decided_by_name=decided_by.get("name"),
        open_tasks=int(tasks.get("open") or 0),
        citation_count=len(citations.get("references") or []),
        evidence_count=len(evidence.get("entries") or []),
        content_hash=row.get("content_hash"),
    )


async def list_reports(
    session: AsyncSession,
    *,
    review_id: UUID | None = None,
    asset_id: UUID | None = None,
    include_superseded: bool = False,
    outcome: str | None = None,
    risk_level: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[ReportSummaryOut]:
    rows = await repo.select_reports(
        session,
        review_id=review_id,
        asset_id=asset_id,
        include_superseded=include_superseded,
        outcome=outcome,
        risk_level=risk_level,
        limit=limit,
        offset=offset,
    )
    return [_to_summary(r) for r in rows]


async def list_reports_for_review(
    session: AsyncSession, review_id: UUID
) -> list[ReportSummaryOut]:
    """Full version history for one review, newest first."""
    rows = await repo.select_versions_for_review(session, review_id)
    return [_to_summary(r) for r in reversed(rows)]


async def load_packets(
    session: AsyncSession, *, include_superseded: bool = False
) -> list[ReportOut]:
    """Hydrated packets for the cross-review analyst export."""
    rows = await repo.select_reports(
        session, include_superseded=include_superseded, limit=1000
    )
    out: list[ReportOut] = []
    for row in rows:
        report = await get_report(session, row["id"])
        if report is not None:
            out.append(report)
    return out
