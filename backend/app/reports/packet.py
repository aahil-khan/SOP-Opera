"""
The closure report packet — what a supervisor, an auditor or a regulator reads.

The previous generator rebuilt the report from *live* tables at close time, so a
report "of" a review reflected whatever the tables happened to say when it ran.
`decisions/service.py` already freezes the exact context and assessment the
supervisor decided on (`evidence.frozen_context_snapshot` /
`frozen_assessment_snapshot`, fingerprinted by `snapshot_hash`), and the report
simply never read them.

So the sourcing rule here is: **the frozen snapshot is the basis, live tables are
only the record.** Anything the supervisor's decision rested on (context,
assessment, reasoning, citations) comes from the snapshot. Anything that
describes what happened *around* the decision (tasks raised, discussion, the
audit trail) is read live at freeze time, because that is what those sections
mean. Every section says which it was, so the UI never has to guess.

Two things deliberately do *not* live in the frozen content:

* **Chain verification.** Its whole purpose is to detect tampering that happened
  *after* the freeze, so freezing "chain ok: true" would make it a decoration.
  It is recomputed on every read and carried in the envelope instead.
* **UUIDs as prose.** Names are resolved at build time, so no renderer is ever
  forced to print a 36-character identifier at a human.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.chain import canonical_payload
from app.reviews.concerns import normalize_concern_type

PACKET_VERSION = 2
GENERATOR = f"sop-opera/reports@{PACKET_VERSION}"

SourceKind = Literal["frozen", "live", "unavailable"]


# --------------------------------------------------------------------------
# Hashing
# --------------------------------------------------------------------------
# jsonb stores numbers as `numeric` while several source columns are REAL, so a
# float can come back from Postgres with more digits than went in and the
# recomputed hash would not match the stored one. A spurious "content altered"
# warning on an audit document is worse than no warning at all, so every float is
# rounded to a fixed precision before it is hashed or stored.
_FLOAT_PRECISION = 6


def _round_floats(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, _FLOAT_PRECISION)
    if isinstance(value, dict):
        return {k: _round_floats(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_round_floats(v) for v in value]
    return value


def packet_hash(content: dict) -> str:
    """SHA-256 over the same canonical JSON the audit chain uses."""
    return hashlib.sha256(
        canonical_payload(_round_floats(content)).encode("utf-8")
    ).hexdigest()


def normalize_content(content: dict) -> dict:
    """Round-trip through JSON so what we hash is what Postgres will store."""
    return _round_floats(json.loads(json.dumps(content, default=str)))


# --------------------------------------------------------------------------
# Human rendering helpers
# --------------------------------------------------------------------------

def humanize(value: str | None) -> str:
    return (value or "").replace("_", " ").strip()


def _iso(value: object) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()  # type: ignore[union-attr]
    return str(value)


_OUTCOME_LABELS = {
    "approved": "Approved",
    "approved_with_conditions": "Approved with conditions",
    "blocked": "Blocked",
}

_CATEGORY_LABELS = {
    "sensor": "Sensor reading",
    "permit": "Permit to work",
    "worker_location": "Worker location",
    "isolation_status": "Isolation status",
    "ppe_status": "PPE status",
    "lift_plan": "Lift plan",
    "supervisor_report": "Supervisor report",
    "weather": "Weather",
    "maintenance": "Maintenance",
}


def _summary_line(category: str, payload: dict, worker_names: dict[str, str]) -> str:
    """
    One line of plain English per context entry.

    This is the difference between an audit packet and a JSON dump: a regulator
    reading the Evidence section should see "Gas 38% LEL (elevated)", not
    `{"gas_reading": 38.0, ...}`. The raw payload is still carried alongside for
    anyone who wants it.
    """
    p = payload or {}

    if category == "sensor":
        bits: list[str] = []
        if isinstance(p.get("gas_reading"), (int, float)):
            bits.append(f"gas {p['gas_reading']}% LEL")
        if isinstance(p.get("temperature"), (int, float)):
            bits.append(f"{p['temperature']}°C")
        if isinstance(p.get("pressure"), (int, float)):
            bits.append(f"{p['pressure']} bar")
        if isinstance(p.get("vibration"), (int, float)):
            bits.append(f"vibration {p['vibration']}")
        if p.get("sensor_id"):
            bits.append(f"sensor {p['sensor_id']}")
        if bits:
            return " · ".join(bits)

    elif category == "permit":
        bits = []
        if p.get("work_type"):
            bits.append(humanize(str(p["work_type"])))
        if p.get("status"):
            bits.append(str(p["status"]))
        if p.get("permit_id"):
            bits.append(f"permit {p['permit_id']}")
        if bits:
            return " · ".join(bits)

    elif category == "worker_location":
        wid = str(p.get("worker_id") or "")
        who = worker_names.get(wid) or (f"worker {wid[:8]}" if wid else "a worker")
        zone = p.get("zone")
        if zone == "hazardous":
            return f"{who} in a hazardous zone"
        if zone:
            return f"{who} in a {zone} zone"
        return f"{who} on site"

    elif category == "isolation_status":
        confirmed = p.get("isolation_confirmed")
        state = "confirmed" if confirmed is True else "not confirmed"
        pid = p.get("permit_id")
        return f"Isolation {state}" + (f" for permit {pid}" if pid else "")

    elif category == "ppe_status":
        if p.get("compliant") is False:
            missing = p.get("missing") or p.get("missing_ppe")
            return f"PPE non-compliant{f': {missing}' if missing else ''}"
        return "PPE compliant"

    elif category == "weather":
        bits = []
        if p.get("condition"):
            bits.append(humanize(str(p["condition"])))
        if isinstance(p.get("wind_speed"), (int, float)):
            bits.append(f"wind {p['wind_speed']} m/s")
        if bits:
            return " · ".join(bits)

    elif category == "supervisor_report":
        return str(p.get("description") or p.get("concern_type") or "Supervisor report")

    # Fall back to a compact key/value rendering rather than raw JSON braces.
    parts = [f"{humanize(k)} {v}" for k, v in list(p.items())[:4] if v is not None]
    return " · ".join(parts) if parts else "No detail recorded"


_FACT_LABELS = {
    "elevated_gas": "Gas above the early-warning threshold",
    "critical_gas": "Gas at or above the critical threshold",
    "zone_occupied": "Workers present in a hazardous zone",
    "hot_work_active": "Hot work permit active",
    "incomplete_isolation": "Isolation not confirmed for hazardous work",
    "ppe_non_compliance": "PPE non-compliance reported",
    "overdue_maintenance": "Maintenance overdue",
}


def fact_label(fact_type: str) -> str:
    return _FACT_LABELS.get(fact_type, humanize(fact_type).capitalize())


# --------------------------------------------------------------------------
# Packet models
# --------------------------------------------------------------------------

class PacketMeta(BaseModel):
    packet_version: int = PACKET_VERSION
    report_id: str | None = None
    review_id: str
    closure_event_seq: int
    version_label: str
    report_ref: str
    supersedes_report_id: str | None = None
    frozen_at: str | None = None
    closed_by: str | None = None
    generator: str = GENERATOR
    hash_algorithm: str = "sha256"
    evidence_id: str | None = None
    snapshot_hash: str | None = None
    built_from: str = "frozen_evidence"
    audit_tail_seq: int | None = None


class PacketAsset(BaseModel):
    id: str
    name: str
    zone: str
    plant_id: str
    floor: str = "ground"


class PacketPerson(BaseModel):
    id: str | None = None
    name: str
    role: str | None = None


class PacketHeader(BaseModel):
    title: str
    asset: PacketAsset
    review_state: str
    origin: str | None = None
    triggered_by: str | None = None
    opened_at: str | None = None
    closed_at: str | None = None
    duration_seconds: float | None = None
    owner: PacketPerson | None = None
    area_owner: PacketPerson | None = None
    raised_by: PacketPerson | None = None
    tagged_workers: list[PacketPerson] = Field(default_factory=list)
    supervisor_report: dict | None = None
    outcome_headline: str
    risk_headline: str


class PacketDisposition(BaseModel):
    recommendation_id: str | None = None
    text: str
    rationale: str | None = None
    disposition: str | None = None


class PacketDecision(BaseModel):
    id: str
    outcome: str
    outcome_label: str
    conditions: str | None = None
    comments: str | None = None
    decided_by: PacketPerson | None = None
    submitted_at: str | None = None
    assessment_id: str | None = None
    time_to_decision_seconds: float | None = None
    dispositions: list[PacketDisposition] = Field(default_factory=list)


class PacketAssessment(BaseModel):
    source: SourceKind = "frozen"
    id: str | None = None
    version: int | None = None
    assessment_type: str | None = None
    status: str | None = None
    risk_level: str | None = None
    summary: str | None = None
    created_at: str | None = None
    provider: str | None = None
    model: str | None = None
    confidence: float | None = None
    retrieval_mode: str | None = None
    retrieval_quality: str | None = None
    latency_ms: int | None = None
    cost_usd: float | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    failure_reason: str | None = None


class PacketFact(BaseModel):
    id: str | None = None
    fact_type: str
    label: str
    value: Any = None
    computed_at: str | None = None
    source_context_ids: list[str] = Field(default_factory=list)


class PacketContextEntry(BaseModel):
    id: str | None = None
    category: str
    category_label: str
    summary_line: str
    provider: str | None = None
    valid_from: str | None = None
    valid_until: str | None = None
    confidence: float | None = None
    payload: dict = Field(default_factory=dict)


class PacketEvidence(BaseModel):
    source: SourceKind = "frozen"
    note: str | None = None
    snapshot_hash: str | None = None
    captured_at: str | None = None
    entries: list[PacketContextEntry] = Field(default_factory=list)


class PacketCitation(BaseModel):
    source: str | None = None
    id: str | None = None
    code: str | None = None
    clause: str | None = None
    title: str | None = None
    snippet: str | None = None
    source_url: str | None = None
    cited_in_summary: bool = False


class PacketCitations(BaseModel):
    source: SourceKind = "frozen"
    references: list[PacketCitation] = Field(default_factory=list)
    cited: list[str] = Field(default_factory=list)
    unsupported: list[str] = Field(default_factory=list)
    ok: bool = True


class PacketTask(BaseModel):
    id: str
    task_type: str
    title: str
    detail: str | None = None
    status: str
    assigned_worker_name: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    acknowledged_at: str | None = None
    done_at: str | None = None
    done_note: str | None = None


class PacketTasks(BaseModel):
    source: SourceKind = "live"
    total: int = 0
    open: int = 0
    acknowledged: int = 0
    done: int = 0
    cancelled: int = 0
    items: list[PacketTask] = Field(default_factory=list)


class PacketComment(BaseModel):
    id: str
    author_kind: str | None = None
    author_name: str | None = None
    body: str
    created_at: str | None = None


class PacketAuditEntry(BaseModel):
    seq: int | None = None
    recorded_at: str | None = None
    entity_type: str | None = None
    event_type: str
    event_label: str
    actor: str | None = None
    prev_hash: str | None = None
    entry_hash: str | None = None


class PacketTimelineEvent(BaseModel):
    ts: str | None = None
    label: str
    actor: str | None = None
    detail: str | None = None


class ReportPacket(BaseModel):
    """The frozen content of one closure report."""

    meta: PacketMeta
    header: PacketHeader
    decision: PacketDecision | None = None
    assessment: PacketAssessment | None = None
    reasoning_factors: list[dict] = Field(default_factory=list)
    recommendations: list[PacketDisposition] = Field(default_factory=list)
    facts: list[PacketFact] = Field(default_factory=list)
    evidence: PacketEvidence = Field(default_factory=PacketEvidence)
    citations: PacketCitations = Field(default_factory=PacketCitations)
    tasks: PacketTasks = Field(default_factory=PacketTasks)
    discussion: list[PacketComment] = Field(default_factory=list)
    audit_trail: list[PacketAuditEntry] = Field(default_factory=list)
    timeline: list[PacketTimelineEvent] = Field(default_factory=list)


def version_label(seq: int) -> str:
    return f"v{seq}"


def report_ref(review_id: UUID | str, seq: int) -> str:
    """A short, human-quotable reference. Stable for a given report."""
    return f"SOP-{str(review_id)[:8].upper()}-{version_label(seq)}"


# --------------------------------------------------------------------------
# Building a packet at freeze time
# --------------------------------------------------------------------------

def _as_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _as_dict(value: Any) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


_EVENT_LABELS = {
    "review.opened": "Review opened",
    "review.created": "Review opened",
    "review.trigger_assessment": "Assessment started",
    "review.assessment_completed": "Assessment completed",
    "review.submit_decision": "Decision recorded",
    "review.close": "Review closed",
    "review.reopen": "Review reopened",
    "review.risk_returned": "Risk returned — reassessment required",
    "decision.submitted": "Decision submitted",
    "evidence.captured": "Evidence captured",
    "report.generated": "Closure report frozen",
}


def event_label(event_type: str) -> str:
    if event_type in _EVENT_LABELS:
        return _EVENT_LABELS[event_type]
    # Fall back to a readable phrase: strip the "domain." prefix and de-snake,
    # so an unmapped "foo.bar_baz" reads "Bar baz", never "Foo.bar baz".
    tail = event_type.split(".", 1)[-1]
    return humanize(tail).capitalize() or humanize(event_type).capitalize()


async def build_packet(
    session: AsyncSession,
    review,
    *,
    actor: str,
    closure_event_seq: int,
    supersedes_report_id: UUID | None,
    frozen_at: datetime,
) -> ReportPacket:
    """
    Assemble the frozen packet for one closure.

    Reads the decision-time evidence snapshot as the basis and falls back to live
    tables only when a review was closed without one (which the FSM makes rare —
    `decided → closed` is the only close edge — but a legacy row can still be in
    that state).
    """
    from app.reports import repository as repo

    review_id = review.id
    review_row = await repo.select_review_row(session, review_id) or {}
    asset_row = await repo.select_asset(session, review.asset_id)
    evidence_row = await repo.select_latest_evidence(session, review_id)
    decision_row = await repo.select_latest_decision(session, review_id)

    asset = PacketAsset(
        id=str(review.asset_id),
        name=(asset_row or {}).get("name") or "Unknown asset",
        zone=(asset_row or {}).get("zone") or "unknown",
        plant_id=(asset_row or {}).get("plant_id") or "unknown",
        floor=(asset_row or {}).get("floor") or "ground",
    )

    # ---- assessment: frozen snapshot first -------------------------------
    frozen_assessment = _as_dict((evidence_row or {}).get("frozen_assessment_snapshot"))
    frozen_context = _as_list((evidence_row or {}).get("frozen_context_snapshot"))
    built_from = "frozen_evidence" if frozen_assessment or frozen_context else "live_fallback"

    assessment_id = (
        frozen_assessment.get("id")
        or (decision_row or {}).get("assessment_id")
    )
    if assessment_id is None:
        latest = await repo.select_latest_complete_assessment(session, review_id)
        assessment_id = (latest or {}).get("id")

    live_assessment = (
        await repo.select_assessment(session, assessment_id) if assessment_id else None
    ) or {}

    def pick(key: str):
        """Frozen value wins; live fills the fields the snapshot does not carry."""
        if key in frozen_assessment and frozen_assessment[key] is not None:
            return frozen_assessment[key]
        return live_assessment.get(key)

    assessment: PacketAssessment | None = None
    if assessment_id or live_assessment:
        assessment = PacketAssessment(
            source="frozen" if frozen_assessment else "live",
            id=str(assessment_id) if assessment_id else None,
            version=pick("version"),
            assessment_type=pick("assessment_type"),
            status=pick("status"),
            risk_level=pick("risk_level"),
            summary=pick("summary"),
            created_at=_iso(pick("created_at")),
            provider=pick("provider"),
            model=pick("model"),
            confidence=pick("confidence"),
            # Cost/latency/token telemetry is not part of the decision basis and
            # is not in the snapshot — read it live.
            retrieval_mode=live_assessment.get("retrieval_mode"),
            retrieval_quality=live_assessment.get("retrieval_quality"),
            latency_ms=live_assessment.get("latency_ms"),
            cost_usd=live_assessment.get("cost_usd"),
            tokens_in=live_assessment.get("tokens_in"),
            tokens_out=live_assessment.get("tokens_out"),
            failure_reason=pick("failure_reason"),
        )

    reasoning_factors = _as_list(
        frozen_assessment.get("reasoning_factors")
        if frozen_assessment.get("reasoning_factors") is not None
        else live_assessment.get("reasoning_factors")
    )

    # ---- recommendations -------------------------------------------------
    rec_rows = _as_list(frozen_assessment.get("recommendations"))
    if not rec_rows and assessment_id:
        rec_rows = await repo.select_recommendations(session, assessment_id)
    recommendations = [
        PacketDisposition(
            recommendation_id=str(r.get("id")) if r.get("id") else None,
            text=str(r.get("text") or ""),
            rationale=r.get("rationale"),
            disposition=r.get("disposition"),
        )
        for r in rec_rows
        if isinstance(r, dict)
    ]

    # ---- evidence: the headline fix --------------------------------------
    worker_ids = [
        str((e.get("payload") or {}).get("worker_id"))
        for e in frozen_context
        if isinstance(e, dict) and (e.get("payload") or {}).get("worker_id")
    ]
    worker_names = await repo.select_workers_by_id(session, sorted(set(worker_ids)))

    evidence_entries = [
        PacketContextEntry(
            id=str(e.get("id")) if e.get("id") else None,
            category=str(e.get("category") or "unknown"),
            category_label=_CATEGORY_LABELS.get(
                str(e.get("category")), humanize(str(e.get("category"))).capitalize()
            ),
            summary_line=_summary_line(
                str(e.get("category") or ""), e.get("payload") or {}, worker_names
            ),
            provider=e.get("provider"),
            valid_from=_iso(e.get("valid_from")),
            valid_until=_iso(e.get("valid_until")),
            confidence=e.get("confidence"),
            payload=e.get("payload") or {},
        )
        for e in frozen_context
        if isinstance(e, dict)
    ]

    evidence = PacketEvidence(
        source="frozen" if frozen_context else "unavailable",
        note=(
            None
            if frozen_context
            else "No decision-time evidence snapshot was recorded for this review."
        ),
        snapshot_hash=(evidence_row or {}).get("snapshot_hash"),
        captured_at=_iso((evidence_row or {}).get("captured_at")),
        entries=evidence_entries,
    )

    # ---- facts -----------------------------------------------------------
    fact_ids = [str(f) for f in (_as_list(frozen_assessment.get("derived_fact_ids")) or [])]
    if not fact_ids:
        fact_ids = [str(f) for f in (live_assessment.get("derived_fact_ids") or [])]
    fact_rows = await repo.select_facts(session, fact_ids)
    if not fact_rows:
        fact_rows = await repo.select_facts_for_asset(session, review.asset_id)
    facts = [
        PacketFact(
            id=str(f.get("id")),
            fact_type=str(f.get("fact_type")),
            label=fact_label(str(f.get("fact_type"))),
            value=f.get("value"),
            computed_at=_iso(f.get("computed_at")),
            source_context_ids=[str(c) for c in (f.get("source_context_ids") or [])],
        )
        for f in fact_rows
    ]

    # ---- citations -------------------------------------------------------
    refs = _as_list(
        frozen_assessment.get("retrieved_references")
        if frozen_assessment.get("retrieved_references") is not None
        else live_assessment.get("retrieved_references")
    )
    summary_text = (assessment.summary if assessment else None) or ""
    citations = _build_citations(refs, summary_text, frozen=bool(frozen_assessment))

    # ---- decision --------------------------------------------------------
    decision: PacketDecision | None = None
    if decision_row:
        opened_at = review_row.get("created_at")
        submitted_at = decision_row.get("submitted_at")
        ttd = None
        if opened_at and submitted_at:
            try:
                ttd = (submitted_at - opened_at).total_seconds()
            except TypeError:
                ttd = None
        by_id = decision_row.get("decided_by")
        decision = PacketDecision(
            id=str(decision_row["id"]),
            outcome=str(decision_row.get("outcome") or "unknown"),
            outcome_label=_OUTCOME_LABELS.get(
                str(decision_row.get("outcome")),
                humanize(str(decision_row.get("outcome"))),
            ),
            conditions=decision_row.get("conditions"),
            comments=decision_row.get("comments"),
            decided_by=PacketPerson(
                id=str(by_id) if by_id else None,
                name=decision_row.get("decided_by_name") or "Unknown supervisor",
                role=decision_row.get("decided_by_role"),
            ),
            submitted_at=_iso(submitted_at),
            assessment_id=str(decision_row.get("assessment_id"))
            if decision_row.get("assessment_id")
            else None,
            time_to_decision_seconds=ttd,
            dispositions=recommendations,
        )

    # ---- tasks / discussion ---------------------------------------------
    task_rows = await repo.select_tasks(session, review_id)
    tasks = PacketTasks(
        total=len(task_rows),
        open=sum(1 for t in task_rows if t.get("status") == "open"),
        acknowledged=sum(1 for t in task_rows if t.get("status") == "acknowledged"),
        done=sum(1 for t in task_rows if t.get("status") == "done"),
        cancelled=sum(1 for t in task_rows if t.get("status") == "cancelled"),
        items=[
            PacketTask(
                id=str(t["id"]),
                task_type=str(t.get("task_type") or "follow_up"),
                title=str(t.get("title") or ""),
                detail=t.get("detail"),
                status=str(t.get("status") or "open"),
                assigned_worker_name=t.get("assigned_worker_name"),
                created_by=t.get("created_by"),
                created_at=_iso(t.get("created_at")),
                acknowledged_at=_iso(t.get("acknowledged_at")),
                done_at=_iso(t.get("done_at")),
                done_note=t.get("done_note"),
            )
            for t in task_rows
        ],
    )

    comment_rows = await repo.select_comments(session, review_id)
    discussion = [
        PacketComment(
            id=str(c["id"]),
            author_kind=c.get("author_kind"),
            author_name=c.get("author_name"),
            body=str(c.get("body") or ""),
            created_at=_iso(c.get("created_at")),
        )
        for c in comment_rows
    ]

    # ---- audit trail + timeline -----------------------------------------
    entity_ids = [str(review_id)]
    if decision_row:
        entity_ids.append(str(decision_row["id"]))
    if evidence_row:
        entity_ids.append(str(evidence_row["id"]))
    if assessment_id:
        entity_ids.append(str(assessment_id))
    audit_rows = await repo.select_audit_entries(session, entity_ids)

    audit_trail = [
        PacketAuditEntry(
            seq=a.get("seq"),
            recorded_at=_iso(a.get("recorded_at")),
            entity_type=a.get("entity_type"),
            event_type=str(a.get("event_type")),
            event_label=event_label(str(a.get("event_type"))),
            actor=a.get("actor"),
            prev_hash=a.get("prev_hash"),
            entry_hash=a.get("entry_hash"),
        )
        for a in audit_rows
    ]
    audit_tail_seq = audit_rows[-1].get("seq") if audit_rows else None

    timeline = [
        PacketTimelineEvent(
            ts=a.recorded_at, label=a.event_label, actor=a.actor, detail=None
        )
        for a in audit_trail
    ]

    # ---- header ----------------------------------------------------------
    owner_id = review_row.get("owner_id")
    tagged_ids = [str(w) for w in (review_row.get("tagged_worker_ids") or [])]
    raised_id = review_row.get("raised_by_worker_id")
    extra_names = await repo.select_workers_by_id(
        session,
        sorted(set(tagged_ids) | ({str(raised_id)} if raised_id else set())),
    )

    outcome_label = decision.outcome_label if decision else "No decision recorded"
    risk_level = (assessment.risk_level if assessment else None) or "unknown"
    closed_at = review_row.get("closed_at") or frozen_at
    opened_at = review_row.get("created_at")
    duration = None
    if opened_at and closed_at:
        try:
            duration = (closed_at - opened_at).total_seconds()
        except TypeError:
            duration = None

    who = decision.decided_by.name if decision and decision.decided_by else None
    outcome_headline = f"{outcome_label} by {who}" if who and decision else outcome_label

    concern_type = review_row.get("report_concern_type")
    supervisor_report = None
    if review_row.get("report_description") or concern_type:
        supervisor_report = {
            "description": review_row.get("report_description"),
            "concern_type": normalize_concern_type(concern_type) if concern_type else None,
        }

    header = PacketHeader(
        title=f"Closure report — {asset.name} · {outcome_label.lower()}",
        asset=asset,
        review_state=str(review_row.get("state") or review.state),
        origin=review_row.get("origin"),
        triggered_by=review_row.get("triggered_by"),
        opened_at=_iso(opened_at),
        closed_at=_iso(closed_at),
        duration_seconds=duration,
        owner=PacketPerson(
            id=str(owner_id) if owner_id else None,
            name=review_row.get("owner_name") or "Unassigned",
            role=review_row.get("owner_role"),
        )
        if owner_id
        else None,
        raised_by=PacketPerson(
            id=str(raised_id), name=extra_names.get(str(raised_id), "A worker")
        )
        if raised_id
        else None,
        tagged_workers=[
            PacketPerson(id=w, name=extra_names.get(w, "A worker")) for w in tagged_ids
        ],
        supervisor_report=supervisor_report,
        outcome_headline=outcome_headline,
        risk_headline=humanize(risk_level).capitalize(),
    )

    meta = PacketMeta(
        review_id=str(review_id),
        closure_event_seq=closure_event_seq,
        version_label=version_label(closure_event_seq),
        report_ref=report_ref(review_id, closure_event_seq),
        supersedes_report_id=str(supersedes_report_id) if supersedes_report_id else None,
        frozen_at=_iso(frozen_at),
        closed_by=actor,
        evidence_id=str(evidence_row["id"]) if evidence_row else None,
        snapshot_hash=(evidence_row or {}).get("snapshot_hash"),
        built_from=built_from,
        audit_tail_seq=audit_tail_seq,
    )

    return ReportPacket(
        meta=meta,
        header=header,
        decision=decision,
        assessment=assessment,
        reasoning_factors=[f for f in reasoning_factors if isinstance(f, dict)],
        recommendations=recommendations,
        facts=facts,
        evidence=evidence,
        citations=citations,
        tasks=tasks,
        discussion=discussion,
        audit_trail=audit_trail,
        timeline=timeline,
    )


def _build_citations(refs: list, summary: str, *, frozen: bool) -> PacketCitations:
    """
    The regulatory section, carrying the citation check that vetted the summary.

    `assessment/citations.py` already validates generated prose against what was
    actually retrieved; carrying its verdict into the packet is what lets a report
    claim "this summary only cites what the evidence supports".
    """
    from app.assessment.citations import check_citations, extract_citations

    references = [
        PacketCitation(
            source=r.get("source") or r.get("source_type"),
            id=str(r.get("id")) if r.get("id") else None,
            code=r.get("code"),
            clause=r.get("clause"),
            title=r.get("title"),
            snippet=r.get("snippet") or r.get("text"),
            source_url=r.get("source_url"),
        )
        for r in refs
        if isinstance(r, dict)
    ]

    cited = extract_citations(summary)
    supported: list[str] = []
    unsupported: list[str] = []
    try:
        check = check_citations(summary, refs)
        supported = list(getattr(check, "supported", []) or [])
        unsupported = list(getattr(check, "unsupported", []) or [])
    except Exception:  # pragma: no cover - never fail a freeze on a reporting nicety
        pass

    supported_set = {s.lower() for s in supported}
    for ref in references:
        token = (ref.code or "").lower()
        ref.cited_in_summary = bool(token) and token in supported_set

    return PacketCitations(
        source="frozen" if frozen else "live",
        references=references,
        cited=cited,
        unsupported=unsupported,
        ok=not unsupported,
    )


# --------------------------------------------------------------------------
# Reading a packet back
# --------------------------------------------------------------------------

LEGACY_BANNER = (
    "This report predates packet v2. Sections marked unavailable were not "
    "frozen at the time of closure."
)


def hydrate_packet(raw: dict, *, row: Any) -> ReportPacket:
    """
    Turn a stored `content` blob into a v2 packet.

    Never writes and never reads the database: upgrading a stored row in place
    would change its `content_hash` and break the very immutability the freeze
    exists to provide. v1 rows are upcast in memory, every turn.

    `closure_event_seq` is always taken from the **column**, never from
    `content` — the schema's duplicate-renumbering UPDATE can legitimately make
    the two disagree on old rows.
    """
    seq = int(row["closure_event_seq"])
    version = int(row.get("packet_version") or 1)

    if version >= PACKET_VERSION:
        try:
            packet = ReportPacket.model_validate(raw)
        except Exception:
            # A packet you cannot open is worse than one with empty sections.
            return _legacy_packet(raw, row=row, seq=seq, note="unreadable_v2")
        packet.meta.report_id = str(row["id"])
        packet.meta.closure_event_seq = seq
        return packet

    return _legacy_packet(raw, row=row, seq=seq, note="legacy_v1")


def _legacy_packet(raw: dict, *, row: Any, seq: int, note: str) -> ReportPacket:
    """Best-effort upcast of the pre-rework content shape."""
    raw = raw or {}
    asset_raw = raw.get("asset") or {}
    review_raw = raw.get("review") or {}
    snap = raw.get("assessment_snapshot") or {}
    meta_raw = snap.get("metadata") or {}
    decision_raw = raw.get("decision") or {}
    evidence_raw = raw.get("evidence") or {}
    review_id = str(row["review_id"])

    outcome = str(decision_raw.get("outcome") or "unknown")
    outcome_label = _OUTCOME_LABELS.get(outcome, humanize(outcome) or "Unknown")

    asset = PacketAsset(
        id=str(asset_raw.get("id") or ""),
        name=str(asset_raw.get("name") or "Unknown asset"),
        zone=str(asset_raw.get("zone") or "unknown"),
        plant_id=str(asset_raw.get("plant_id") or "unknown"),
        floor=str(asset_raw.get("floor") or "ground"),
    )

    recommendations = [
        PacketDisposition(
            recommendation_id=str(r.get("id")) if r.get("id") else None,
            text=str(r.get("text") or ""),
            rationale=r.get("rationale"),
            disposition=r.get("disposition"),
        )
        for r in (snap.get("recommendations") or [])
        if isinstance(r, dict)
    ]

    decision = None
    if decision_raw:
        decision = PacketDecision(
            id=str(decision_raw.get("id") or ""),
            outcome=outcome,
            outcome_label=outcome_label,
            conditions=decision_raw.get("conditions"),
            comments=decision_raw.get("comments"),
            decided_by=None,
            submitted_at=decision_raw.get("submitted_at"),
            assessment_id=decision_raw.get("assessment_id"),
            dispositions=recommendations,
        )

    assessment = None
    if snap:
        assessment = PacketAssessment(
            source="unavailable",
            id=str(snap.get("id")) if snap.get("id") else None,
            version=snap.get("version"),
            risk_level=snap.get("risk_level"),
            summary=snap.get("summary"),
            provider=meta_raw.get("provider"),
            confidence=meta_raw.get("confidence"),
            retrieval_mode=meta_raw.get("retrieval_mode"),
            retrieval_quality=meta_raw.get("retrieval_quality"),
        )

    # v1 froze context *ids* only, so there is genuinely no content to show.
    # Emit stubs rather than an empty section, so the gap is visible.
    stub_entries = [
        PacketContextEntry(
            id=str(cid),
            category="unknown",
            category_label="Context entry",
            summary_line="Content not frozen — this report predates evidence snapshots.",
        )
        for cid in (evidence_raw.get("frozen_context_ids") or [])
    ]

    return ReportPacket(
        meta=PacketMeta(
            packet_version=1,
            report_id=str(row["id"]),
            review_id=review_id,
            closure_event_seq=seq,
            version_label=version_label(seq),
            report_ref=report_ref(review_id, seq),
            frozen_at=_iso(row.get("frozen_at") or row.get("generated_at")),
            closed_by=row.get("closed_by"),
            evidence_id=str(evidence_raw.get("id")) if evidence_raw.get("id") else None,
            built_from=note,
        ),
        header=PacketHeader(
            title=str(raw.get("title") or f"Closure report — {asset.name}"),
            asset=asset,
            review_state=str(review_raw.get("state") or "closed"),
            triggered_by=review_raw.get("triggered_by"),
            outcome_headline=outcome_label,
            risk_headline=humanize(str(snap.get("risk_level") or "unknown")).capitalize(),
        ),
        decision=decision,
        assessment=assessment,
        recommendations=recommendations,
        evidence=PacketEvidence(
            source="unavailable",
            note="Pre-v2 report: context ids only, content was not frozen.",
            captured_at=evidence_raw.get("captured_at"),
            entries=stub_entries,
        ),
        citations=PacketCitations(source="unavailable"),
        tasks=PacketTasks(source="unavailable"),
    )
