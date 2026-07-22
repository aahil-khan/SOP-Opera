"""
PDF rendering of a closure packet.

Pure function over an already-hydrated `ReportOut` — no session, no I/O — so it
unit-tests without Postgres, which matters because the DB-backed suite is slow.

Uses reportlab's Platypus layer rather than the low-level canvas: the packet has
six variable-length tables (evidence, facts, citations, recommendations, tasks,
audit trail) and Platypus splits them across pages and reflows paragraphs on its
own. Hand-managing a y-cursor for each of those is where PDF generators go to die.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.reports.packet import LEGACY_BANNER
from app.reports.schemas import ReportOut

# Print-appropriate palette. The web UI is theme-driven, but a PDF is a document:
# it must read on white paper in a filing cabinet, so these are fixed and dark.
INK = colors.HexColor("#14181d")
MUTED = colors.HexColor("#5c6672")
RULE = colors.HexColor("#c9d0d8")
BAND = colors.HexColor("#f2f4f7")
RISK_COLORS = {
    "nominal": colors.HexColor("#217a52"),
    "elevated": colors.HexColor("#96700f"),
    "blocking": colors.HexColor("#b03744"),
    "critical": colors.HexColor("#a3151f"),
}


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontName="Helvetica-Bold",
            fontSize=19, leading=23, textColor=INK, alignment=TA_LEFT, spaceAfter=2,
        ),
        "ref": ParagraphStyle(
            "ref", parent=base["Normal"], fontName="Courier",
            fontSize=8, leading=11, textColor=MUTED, spaceAfter=8,
        ),
        "eyebrow": ParagraphStyle(
            "eyebrow", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=7.5, leading=10, textColor=MUTED, spaceBefore=12, spaceAfter=4,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=11.5, leading=15, textColor=INK, spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body", parent=base["Normal"], fontName="Helvetica",
            fontSize=9.2, leading=13.4, textColor=INK, spaceAfter=4,
        ),
        "muted": ParagraphStyle(
            "muted", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.2, leading=11.5, textColor=MUTED, spaceAfter=3,
        ),
        "mono": ParagraphStyle(
            "mono", parent=base["Normal"], fontName="Courier",
            fontSize=7.6, leading=10, textColor=MUTED,
        ),
        "cell": ParagraphStyle(
            "cell", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.2, leading=11, textColor=INK,
        ),
        "cellHead": ParagraphStyle(
            "cellHead", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=7.4, leading=10, textColor=MUTED,
        ),
    }


def _esc(value: Any) -> str:
    s = "" if value is None else str(value)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt_ts(value: Any) -> str:
    """`2026-03-14T09:42:11+00:00` is machine output; a report wants a date."""
    if not value:
        return "—"
    s = str(value)
    try:
        from datetime import datetime

        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%d %b %Y, %H:%M")
    except ValueError:
        return s


def _fmt_duration(seconds: float | None) -> str:
    if not seconds:
        return "—"
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m = rem // 60
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


def _table(rows: list[list], styles, widths: list[float], *, head: bool = True) -> Table:
    t = Table(rows, colWidths=widths, repeatRows=1 if head else 0, hAlign="LEFT")
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
    ]
    if head:
        style += [
            ("BACKGROUND", (0, 0), (-1, 0), BAND),
            ("LINEBELOW", (0, 0), (-1, 0), 0.7, RULE),
        ]
    t.setStyle(TableStyle(style))
    return t


def _kv(label: str, value: str, s) -> list:
    return [Paragraph(_esc(label), s["cellHead"]), Paragraph(_esc(value), s["cell"])]


def render_report_pdf(report: ReportOut) -> bytes:
    """Render one closure packet as a paginated PDF document."""
    s = _styles()
    packet = report.content
    buf = BytesIO()

    ref = packet.meta.report_ref
    footer_hash = (report.content_hash or "not recorded")[:16]

    def _chrome(canvas, doc):
        """Header rule and a footer carrying the freeze fingerprint on every page."""
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, A4[1] - 12 * mm, "SOP OPERA · CLOSURE AUDIT PACKET")
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 12 * mm, ref)
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, A4[1] - 14 * mm, A4[0] - 18 * mm, A4[1] - 14 * mm)

        canvas.line(18 * mm, 15 * mm, A4[0] - 18 * mm, 15 * mm)
        canvas.setFont("Courier", 6.5)
        canvas.drawString(18 * mm, 11 * mm, f"content hash {footer_hash}…")
        canvas.setFont("Helvetica", 7)
        canvas.drawRightString(A4[0] - 18 * mm, 11 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=f"{ref} — {packet.header.asset.name}",
        author="SOP Opera",
        subject="Closure audit packet",
    )

    body_width = A4[0] - 36 * mm
    flow: list = []

    # ---- cover -----------------------------------------------------------
    flow.append(Paragraph(_esc(packet.header.asset.name), s["title"]))
    flow.append(
        Paragraph(
            f"{ref} &nbsp;·&nbsp; {packet.meta.version_label}"
            + (" · superseded" if not report.is_current else " · current")
            + f" &nbsp;·&nbsp; frozen {_fmt_ts(packet.meta.frozen_at)}",
            s["ref"],
        )
    )
    flow.append(
        Paragraph(f"<b>{_esc(packet.header.outcome_headline)}</b>", s["h2"])
    )
    risk = (packet.header.risk_headline or "").lower()
    risk_color = RISK_COLORS.get(risk, MUTED)
    flow.append(
        Paragraph(
            f'Assessed risk: <font color="{risk_color.hexval()}"><b>'
            f"{_esc(packet.header.risk_headline)}</b></font>",
            s["body"],
        )
    )

    if packet.meta.packet_version < 2:
        flow.append(Spacer(1, 4))
        flow.append(Paragraph(f"<i>{_esc(LEGACY_BANNER)}</i>", s["muted"]))

    flow.append(Spacer(1, 6))
    flow.append(HRFlowable(width="100%", thickness=0.6, color=RULE))

    # ---- at a glance -----------------------------------------------------
    h = packet.header
    facts_rows = [
        _kv("Asset", f"{h.asset.name} · {h.asset.zone} · {h.asset.plant_id}", s),
        _kv("Review opened", _fmt_ts(h.opened_at), s),
        _kv("Review closed", _fmt_ts(h.closed_at), s),
        _kv("Open duration", _fmt_duration(h.duration_seconds), s),
        _kv("Raised by", h.raised_by.name if h.raised_by else (h.triggered_by or "—"), s),
        _kv("Area owner", h.owner.name if h.owner else "—", s),
        _kv("Closed by", packet.meta.closed_by or "—", s),
        _kv("Evidence basis", packet.evidence.source, s),
    ]
    flow.append(Paragraph("AT A GLANCE", s["eyebrow"]))
    flow.append(_table(facts_rows, s, [38 * mm, body_width - 38 * mm], head=False))

    # ---- decision --------------------------------------------------------
    if packet.decision:
        d = packet.decision
        flow.append(Paragraph("DECISION OF RECORD", s["eyebrow"]))
        rows = [
            _kv("Outcome", d.outcome_label, s),
            _kv("Decided by", d.decided_by.name if d.decided_by else "—", s),
            _kv("Submitted", _fmt_ts(d.submitted_at), s),
        ]
        if d.conditions:
            rows.append(_kv("Conditions", d.conditions, s))
        if d.comments:
            rows.append(_kv("Comments", d.comments, s))
        flow.append(_table(rows, s, [38 * mm, body_width - 38 * mm], head=False))

    # ---- assessment ------------------------------------------------------
    if packet.assessment and packet.assessment.summary:
        a = packet.assessment
        flow.append(Paragraph("ASSESSMENT SUMMARY", s["eyebrow"]))
        for line in str(a.summary).split("\n"):
            line = line.strip().lstrip("•-* ")
            if line:
                flow.append(Paragraph(_esc(line), s["body"]))
        meta_bits = [
            b
            for b in [
                f"{a.assessment_type or 'ai'} assessment v{a.version}" if a.version else None,
                f"provider {a.provider}" if a.provider else None,
                f"confidence {a.confidence:.2f}" if a.confidence is not None else None,
                f"retrieval {a.retrieval_mode}" if a.retrieval_mode else None,
            ]
            if b
        ]
        if meta_bits:
            flow.append(Paragraph(" · ".join(_esc(b) for b in meta_bits), s["muted"]))

    # ---- why -------------------------------------------------------------
    if packet.reasoning_factors:
        flow.append(Paragraph("WHY THIS CALL WAS MADE", s["eyebrow"]))
        rows = [[Paragraph("Factor", s["cellHead"]), Paragraph("Detail", s["cellHead"])]]
        for f in packet.reasoning_factors:
            rows.append(
                [
                    Paragraph(_esc(f.get("title") or f.get("label") or "Factor"), s["cell"]),
                    Paragraph(_esc(f.get("detail") or f.get("body") or ""), s["cell"]),
                ]
            )
        flow.append(_table(rows, s, [50 * mm, body_width - 50 * mm]))

    # ---- evidence — the headline section ---------------------------------
    flow.append(PageBreak())
    flow.append(Paragraph("EVIDENCE FROZEN AT THE DECISION", s["eyebrow"]))
    if packet.evidence.entries:
        flow.append(
            Paragraph(
                "The plant context as it stood when the decision was recorded. "
                f"Source: {_esc(packet.evidence.source)}."
                + (
                    f" Snapshot fingerprint {_esc(packet.evidence.snapshot_hash[:16])}…"
                    if packet.evidence.snapshot_hash
                    else ""
                ),
                s["muted"],
            )
        )
        rows = [
            [
                Paragraph("Type", s["cellHead"]),
                Paragraph("Reading", s["cellHead"]),
                Paragraph("Source", s["cellHead"]),
                Paragraph("Valid from", s["cellHead"]),
                Paragraph("Conf.", s["cellHead"]),
            ]
        ]
        for e in packet.evidence.entries:
            rows.append(
                [
                    Paragraph(_esc(e.category_label), s["cell"]),
                    Paragraph(_esc(e.summary_line), s["cell"]),
                    Paragraph(_esc(e.provider or "—"), s["cell"]),
                    Paragraph(_fmt_ts(e.valid_from), s["cell"]),
                    Paragraph(
                        f"{e.confidence:.2f}" if e.confidence is not None else "—",
                        s["cell"],
                    ),
                ]
            )
        flow.append(
            _table(
                rows,
                s,
                [30 * mm, body_width - 106 * mm, 24 * mm, 30 * mm, 12 * mm],
            )
        )
    else:
        flow.append(
            Paragraph(_esc(packet.evidence.note or "No evidence recorded."), s["muted"])
        )

    # ---- facts -----------------------------------------------------------
    if packet.facts:
        flow.append(Paragraph("HAZARD FACTS DETECTED", s["eyebrow"]))
        rows = [
            [
                Paragraph("Fact", s["cellHead"]),
                Paragraph("Value", s["cellHead"]),
                Paragraph("Computed", s["cellHead"]),
            ]
        ]
        for f in packet.facts:
            rows.append(
                [
                    Paragraph(_esc(f.label), s["cell"]),
                    Paragraph(_esc(f.value), s["cell"]),
                    Paragraph(_fmt_ts(f.computed_at), s["cell"]),
                ]
            )
        flow.append(_table(rows, s, [body_width - 70 * mm, 30 * mm, 40 * mm]))

    # ---- citations -------------------------------------------------------
    if packet.citations.references:
        flow.append(Paragraph("REGULATORY BASIS", s["eyebrow"]))
        rows = [
            [
                Paragraph("Reference", s["cellHead"]),
                Paragraph("Clause / title", s["cellHead"]),
                Paragraph("Source", s["cellHead"]),
            ]
        ]
        for c in packet.citations.references:
            display_title = c.title
            if (
                (not display_title or display_title == "Historical incident")
                and c.snippet
            ):
                display_title = c.snippet[:100] + ("…" if len(c.snippet) > 100 else "")
            title = " — ".join(x for x in [c.clause, display_title] if x)
            rows.append(
                [
                    Paragraph(_esc(c.code or c.source or "—"), s["cell"]),
                    Paragraph(_esc(title or "—"), s["cell"]),
                    Paragraph(_esc(c.source_url or "—"), s["mono"]),
                ]
            )
        flow.append(_table(rows, s, [32 * mm, body_width - 92 * mm, 60 * mm]))
        if packet.citations.unsupported:
            flow.append(
                Paragraph(
                    "Unsupported citations removed from the summary: "
                    + _esc(", ".join(packet.citations.unsupported)),
                    s["muted"],
                )
            )

    # ---- recommendations -------------------------------------------------
    if packet.recommendations:
        flow.append(Paragraph("RECOMMENDED ACTIONS", s["eyebrow"]))
        for i, r in enumerate(packet.recommendations, 1):
            block = [
                Paragraph(
                    f"<b>{i}. {_esc(r.text)}</b>"
                    + (f" — {_esc(r.disposition)}" if r.disposition else ""),
                    s["body"],
                )
            ]
            if r.rationale:
                block.append(Paragraph(_esc(r.rationale), s["muted"]))
            flow.append(KeepTogether(block))

    # ---- tasks -----------------------------------------------------------
    if packet.tasks.items:
        flow.append(Paragraph("FOLLOW-THROUGH WORK", s["eyebrow"]))
        rows = [
            [
                Paragraph("Task", s["cellHead"]),
                Paragraph("Assigned", s["cellHead"]),
                Paragraph("Status", s["cellHead"]),
                Paragraph("Completed", s["cellHead"]),
            ]
        ]
        for t in packet.tasks.items:
            rows.append(
                [
                    Paragraph(_esc(t.title), s["cell"]),
                    Paragraph(_esc(t.assigned_worker_name or "—"), s["cell"]),
                    Paragraph(_esc(t.status), s["cell"]),
                    Paragraph(_fmt_ts(t.done_at), s["cell"]),
                ]
            )
        flow.append(_table(rows, s, [body_width - 100 * mm, 34 * mm, 24 * mm, 42 * mm]))

    # ---- audit trail -----------------------------------------------------
    if packet.audit_trail:
        flow.append(Paragraph("AUDIT TRAIL", s["eyebrow"]))
        chain_note = (
            "Hash chain intact at time of export."
            if report.integrity.chain_intact
            else f"CHAIN BROKEN — {len(report.integrity.chain_breaks)} break(s) detected."
        )
        flow.append(Paragraph(_esc(chain_note), s["muted"]))
        rows = [
            [
                Paragraph("#", s["cellHead"]),
                Paragraph("Event", s["cellHead"]),
                Paragraph("Actor", s["cellHead"]),
                Paragraph("Recorded", s["cellHead"]),
                Paragraph("Entry hash", s["cellHead"]),
            ]
        ]
        for a in packet.audit_trail:
            rows.append(
                [
                    Paragraph(str(a.seq or "—"), s["mono"]),
                    Paragraph(_esc(a.event_label), s["cell"]),
                    Paragraph(_esc(a.actor or "—"), s["cell"]),
                    Paragraph(_fmt_ts(a.recorded_at), s["cell"]),
                    Paragraph(_esc((a.entry_hash or "")[:12]), s["mono"]),
                ]
            )
        flow.append(
            _table(rows, s, [12 * mm, body_width - 128 * mm, 32 * mm, 32 * mm, 52 * mm])
        )

    doc.build(flow, onFirstPage=_chrome, onLaterPages=_chrome)
    return buf.getvalue()
