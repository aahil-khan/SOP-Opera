"""
A representative packet, built in memory.

Lets the packet and exporter tests run without Postgres — the DB-backed suite is
slow and shares global tables, so anything that can be pure should be.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.reports.packet import (
    PacketAssessment,
    PacketAsset,
    PacketAuditEntry,
    PacketCitation,
    PacketCitations,
    PacketContextEntry,
    PacketDecision,
    PacketDisposition,
    PacketEvidence,
    PacketFact,
    PacketHeader,
    PacketMeta,
    PacketPerson,
    PacketTask,
    PacketTasks,
    ReportPacket,
    fact_label,
    normalize_content,
    packet_hash,
    report_ref,
)
from app.reports.schemas import ReportIntegrity, ReportOut


def make_packet(*, seq: int = 2, review_id=None) -> ReportPacket:
    review_id = review_id or uuid4()
    return ReportPacket(
        meta=PacketMeta(
            review_id=str(review_id),
            closure_event_seq=seq,
            version_label=f"v{seq}",
            report_ref=report_ref(review_id, seq),
            frozen_at="2026-03-14T10:02:00+00:00",
            closed_by="user:priya",
            evidence_id=str(uuid4()),
            snapshot_hash="b" * 64,
        ),
        header=PacketHeader(
            title="Closure report — Coke Oven Battery 3 · blocked",
            asset=PacketAsset(
                id=str(uuid4()),
                name="Coke Oven Battery 3",
                zone="coke-oven-battery",
                plant_id="VSP-1",
                floor="ground",
            ),
            review_state="closed",
            origin="system",
            triggered_by="sensor_threshold",
            opened_at="2026-03-14T09:14:00+00:00",
            closed_at="2026-03-14T10:02:00+00:00",
            duration_seconds=2880,
            owner=PacketPerson(name="R. Menon", role="supervisor"),
            outcome_headline="Blocked by Priya Raman",
            risk_headline="Blocking",
        ),
        decision=PacketDecision(
            id=str(uuid4()),
            outcome="blocked",
            outcome_label="Blocked",
            conditions="Purge and re-test before re-entry",
            comments="Gas trend still rising at decision time.",
            decided_by=PacketPerson(name="Priya Raman", role="supervisor"),
            submitted_at="2026-03-14T09:31:00+00:00",
            time_to_decision_seconds=1020,
        ),
        assessment=PacketAssessment(
            id=str(uuid4()),
            version=2,
            assessment_type="ai",
            status="complete",
            risk_level="blocking",
            summary=(
                "Compound hazard on the coke oven battery.\n"
                "Sensors: gas at 38% LEL and rising.\n"
                "Permits: hot work permit active in the same zone."
            ),
            provider="mock",
            confidence=0.82,
            retrieval_mode="deterministic",
            retrieval_quality="high",
            latency_ms=1240,
            cost_usd=0.0,
        ),
        reasoning_factors=[
            {"title": "Gas trend", "detail": "Rising 4% LEL/min over 6 minutes"},
            {"title": "Ignition source", "detail": "Hot work permit active nearby"},
        ],
        recommendations=[
            PacketDisposition(
                recommendation_id=str(uuid4()),
                text="Halt hot work in the battery zone",
                rationale="Active ignition source beside a rising gas reading.",
                disposition="accepted",
            )
        ],
        facts=[
            PacketFact(
                id=str(uuid4()),
                fact_type="elevated_gas",
                label=fact_label("elevated_gas"),
                value=True,
                computed_at="2026-03-14T09:15:00+00:00",
            )
        ],
        evidence=PacketEvidence(
            source="frozen",
            snapshot_hash="b" * 64,
            captured_at="2026-03-14T09:31:00+00:00",
            entries=[
                PacketContextEntry(
                    id=str(uuid4()),
                    category="sensor",
                    category_label="Sensor reading",
                    summary_line="gas 38.0% LEL · sensor GD-14",
                    provider="scada",
                    valid_from="2026-03-14T09:15:00+00:00",
                    confidence=0.95,
                    payload={"gas_reading": 38.0, "sensor_id": "GD-14"},
                )
            ],
        ),
        citations=PacketCitations(
            references=[
                PacketCitation(
                    source="regulation",
                    code="OISD-STD-105",
                    clause="Cl. 7.3.2",
                    title="Work permit system",
                    source_url="https://www.oisd.gov.in/standards/105",
                    cited_in_summary=True,
                )
            ]
        ),
        tasks=PacketTasks(
            total=1,
            open=1,
            items=[
                PacketTask(
                    id=str(uuid4()),
                    task_type="unblock",
                    title="Purge oven and re-test atmosphere",
                    status="open",
                    assigned_worker_name="S. Rao",
                    created_at="2026-03-14T09:33:00+00:00",
                )
            ],
        ),
        audit_trail=[
            PacketAuditEntry(
                seq=41,
                recorded_at="2026-03-14T10:02:00+00:00",
                entity_type="review",
                event_type="review.close",
                event_label="Review closed",
                actor="api:close",
                entry_hash="c" * 64,
            )
        ],
    )


def make_report(packet: ReportPacket | None = None, **overrides) -> ReportOut:
    packet = packet or make_packet()
    content = normalize_content(packet.model_dump(mode="json"))
    digest = packet_hash(content)
    now = datetime.now(timezone.utc)
    fields = {
        "id": uuid4(),
        "review_id": packet.meta.review_id,
        "closure_event_seq": packet.meta.closure_event_seq,
        "version_label": packet.meta.version_label,
        "is_current": True,
        "packet_version": packet.meta.packet_version,
        "generated_at": now,
        "frozen_at": now,
        "closed_by": packet.meta.closed_by,
        "content_hash": digest,
        "content": packet,
        "integrity": ReportIntegrity(
            content_hash_stored=digest,
            content_hash_recomputed=digest,
            content_hash_status="match",
            chain_intact=True,
            chain_entries_checked=41,
            verified_at=now,
        ),
        "versions": [],
    }
    fields.update(overrides)
    return ReportOut(**fields)
