"""
Excel rendering of closure packets.

Two shapes, because two audiences:

* `render_report_xlsx` — one review, one tab per section. What a safety officer
  attaches to an incident file.
* `render_dataset_xlsx` — every current report flattened into analyst-ready rows.
  This is the one a data analyst actually wants: one row per report, one row per
  fact, one row per citation, all filterable and pivot-ready.

Both are pure functions over hydrated packets, so they test without Postgres.
XlsxWriter (rather than openpyxl) because this path is write-only and wants
`add_table`, `autofilter`, `freeze_panes` and per-column number formats as
first-class calls.
"""

from __future__ import annotations

from datetime import datetime
from io import BytesIO
from typing import Any, Iterable

import xlsxwriter

from app.reports.schemas import ReportOut

# Header band and accents. Excel has no theme to inherit, so these are fixed.
HEADER_BG = "#1f2933"
HEADER_FG = "#ffffff"
LABEL_FG = "#5c6672"
RISK_FILL = {
    "nominal": "#e3f4ea",
    "elevated": "#fdf3d8",
    "blocking": "#fbe3e5",
    "critical": "#f7cdd0",
}


def _fmts(wb: xlsxwriter.Workbook) -> dict[str, Any]:
    return {
        "title": wb.add_format({"bold": True, "font_size": 15, "font_color": "#14181d"}),
        "sub": wb.add_format({"font_size": 9, "font_color": LABEL_FG}),
        "header": wb.add_format(
            {
                "bold": True,
                "font_size": 9,
                "bg_color": HEADER_BG,
                "font_color": HEADER_FG,
                "align": "left",
                "valign": "vcenter",
                "border": 0,
            }
        ),
        "label": wb.add_format(
            {"bold": True, "font_size": 9, "font_color": LABEL_FG, "valign": "top"}
        ),
        "cell": wb.add_format({"font_size": 10, "valign": "top", "text_wrap": True}),
        "cell_plain": wb.add_format({"font_size": 10, "valign": "top"}),
        "mono": wb.add_format({"font_size": 9, "font_name": "Consolas", "valign": "top"}),
        "date": wb.add_format(
            {"font_size": 10, "num_format": "yyyy-mm-dd hh:mm", "valign": "top"}
        ),
        "num": wb.add_format({"font_size": 10, "num_format": "0.00", "valign": "top"}),
        "int": wb.add_format({"font_size": 10, "num_format": "0", "valign": "top"}),
    }


def _dt(value: Any) -> datetime | None:
    """Write real datetimes so Excel can sort and filter them as dates."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    # Excel has no timezone concept; a tz-aware value raises on write.
    return parsed.replace(tzinfo=None)


def _write_grid(
    ws,
    f: dict,
    headers: list[str],
    rows: Iterable[list],
    *,
    widths: list[int],
    kinds: list[str] | None = None,
) -> None:
    """A header band, frozen and filterable, over typed columns."""
    for c, h in enumerate(headers):
        ws.write(0, c, h, f["header"])
    for c, w in enumerate(widths):
        ws.set_column(c, c, w)
    ws.set_row(0, 20)

    r = 0
    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row):
            kind = (kinds or [])[c] if kinds and c < len(kinds) else "text"
            if kind == "date":
                dt = _dt(value)
                ws.write_datetime(r, c, dt, f["date"]) if dt else ws.write_blank(
                    r, c, None, f["cell_plain"]
                )
            elif kind == "num":
                ws.write_number(r, c, float(value), f["num"]) if isinstance(
                    value, (int, float)
                ) else ws.write_blank(r, c, None, f["num"])
            elif kind == "int":
                ws.write_number(r, c, int(value), f["int"]) if isinstance(
                    value, (int, float)
                ) else ws.write_blank(r, c, None, f["int"])
            elif kind == "mono":
                ws.write(r, c, "" if value is None else str(value), f["mono"])
            else:
                ws.write(r, c, "" if value is None else str(value), f["cell"])

    ws.freeze_panes(1, 0)
    ws.autofilter(0, 0, max(r, 1), len(headers) - 1)


def _write_kv(ws, f: dict, pairs: list[tuple[str, Any]], *, start: int = 0) -> int:
    ws.set_column(0, 0, 26)
    ws.set_column(1, 1, 86)
    row = start
    for label, value in pairs:
        ws.write(row, 0, label, f["label"])
        ws.write(row, 1, "" if value is None else str(value), f["cell"])
        row += 1
    return row


def render_report_xlsx(report: ReportOut) -> bytes:
    """One closure packet as a multi-sheet workbook."""
    buf = BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True, "default_date_format": "yyyy-mm-dd hh:mm"})
    f = _fmts(wb)
    p = report.content

    # --- Summary ---------------------------------------------------------
    ws = wb.add_worksheet("Summary")
    ws.write(0, 0, p.header.asset.name, f["title"])
    ws.write(1, 0, f"{p.meta.report_ref} · {p.meta.version_label}", f["sub"])
    row = _write_kv(
        ws,
        f,
        [
            ("Outcome", p.header.outcome_headline),
            ("Assessed risk", p.header.risk_headline),
            ("Asset", f"{p.header.asset.name} · {p.header.asset.zone}"),
            ("Plant", p.header.asset.plant_id),
            ("Review opened", p.header.opened_at),
            ("Review closed", p.header.closed_at),
            ("Closed by", p.meta.closed_by),
            ("Report reference", p.meta.report_ref),
            ("Version", p.meta.version_label),
            ("Is current", "yes" if report.is_current else "no — superseded"),
            ("Packet version", p.meta.packet_version),
            ("Evidence basis", p.evidence.source),
            ("Frozen at", p.meta.frozen_at),
            ("Content hash", report.content_hash),
            ("Content hash status", report.integrity.content_hash_status),
            ("Evidence snapshot hash", p.evidence.snapshot_hash),
            ("Audit chain intact", "yes" if report.integrity.chain_intact else "NO"),
        ],
        start=3,
    )
    if p.assessment and p.assessment.summary:
        ws.write(row + 1, 0, "Assessment summary", f["label"])
        ws.write(row + 1, 1, p.assessment.summary, f["cell"])

    # --- Decision --------------------------------------------------------
    ws = wb.add_worksheet("Decision")
    d = p.decision
    _write_kv(
        ws,
        f,
        [
            ("Outcome", d.outcome_label if d else "No decision recorded"),
            ("Decided by", d.decided_by.name if d and d.decided_by else None),
            ("Submitted at", d.submitted_at if d else None),
            ("Conditions", d.conditions if d else None),
            ("Comments", d.comments if d else None),
            (
                "Time to decision (min)",
                round(d.time_to_decision_seconds / 60, 1)
                if d and d.time_to_decision_seconds
                else None,
            ),
        ],
    )

    # --- Evidence --------------------------------------------------------
    ws = wb.add_worksheet("Evidence")
    _write_grid(
        ws,
        f,
        ["Type", "Reading", "Provider", "Valid from", "Valid until", "Confidence", "Raw payload"],
        [
            [
                e.category_label,
                e.summary_line,
                e.provider,
                e.valid_from,
                e.valid_until,
                e.confidence,
                str(e.payload),
            ]
            for e in p.evidence.entries
        ],
        widths=[20, 48, 14, 18, 18, 11, 60],
        kinds=["text", "text", "text", "date", "date", "num", "mono"],
    )

    # --- Facts -----------------------------------------------------------
    ws = wb.add_worksheet("Facts")
    _write_grid(
        ws,
        f,
        ["Fact", "Type", "Value", "Computed at"],
        [[x.label, x.fact_type, str(x.value), x.computed_at] for x in p.facts],
        widths=[46, 26, 14, 18],
        kinds=["text", "text", "text", "date"],
    )

    # --- Citations -------------------------------------------------------
    ws = wb.add_worksheet("Citations")
    _write_grid(
        ws,
        f,
        ["Code", "Clause", "Title", "Source", "Cited in summary", "URL"],
        [
            [c.code, c.clause, c.title, c.source, "yes" if c.cited_in_summary else "no", c.source_url]
            for c in p.citations.references
        ],
        widths=[18, 20, 52, 14, 16, 46],
    )

    # --- Recommendations -------------------------------------------------
    ws = wb.add_worksheet("Recommendations")
    _write_grid(
        ws,
        f,
        ["#", "Recommendation", "Rationale", "Disposition"],
        [
            [i, r.text, r.rationale, r.disposition]
            for i, r in enumerate(p.recommendations, 1)
        ],
        widths=[5, 52, 60, 18],
        kinds=["int", "text", "text", "text"],
    )

    # --- Tasks -----------------------------------------------------------
    ws = wb.add_worksheet("Tasks")
    _write_grid(
        ws,
        f,
        ["Title", "Type", "Assigned to", "Status", "Created", "Completed", "Note"],
        [
            [t.title, t.task_type, t.assigned_worker_name, t.status, t.created_at, t.done_at, t.done_note]
            for t in p.tasks.items
        ],
        widths=[46, 14, 22, 14, 18, 18, 40],
        kinds=["text", "text", "text", "text", "date", "date", "text"],
    )

    # --- Audit trail -----------------------------------------------------
    ws = wb.add_worksheet("Audit trail")
    _write_grid(
        ws,
        f,
        ["Seq", "Event", "Actor", "Recorded at", "Entry hash", "Previous hash"],
        [
            [a.seq, a.event_label, a.actor, a.recorded_at, a.entry_hash, a.prev_hash]
            for a in p.audit_trail
        ],
        widths=[8, 34, 22, 18, 68, 68],
        kinds=["int", "text", "text", "date", "mono", "mono"],
    )

    wb.close()
    return buf.getvalue()


def render_dataset_xlsx(reports: list[ReportOut]) -> bytes:
    """
    Every report flattened for analysis — the cross-review export.

    Deliberately denormalised: each sheet repeats `report_ref` and asset so a
    pivot table over Facts or Citations needs no lookups.
    """
    buf = BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    f = _fmts(wb)

    # --- Reports ---------------------------------------------------------
    ws = wb.add_worksheet("Reports")
    rows = []
    for r in reports:
        p = r.content
        a = p.assessment
        d = p.decision
        rows.append(
            [
                p.meta.report_ref,
                p.meta.version_label,
                "yes" if r.is_current else "no",
                p.header.asset.name,
                p.header.asset.zone,
                p.header.asset.plant_id,
                p.header.triggered_by,
                p.header.origin,
                d.outcome if d else None,
                a.risk_level if a else None,
                d.decided_by.name if d and d.decided_by else None,
                p.header.opened_at,
                p.header.closed_at,
                round(p.header.duration_seconds / 3600, 2) if p.header.duration_seconds else None,
                round(d.time_to_decision_seconds / 60, 1)
                if d and d.time_to_decision_seconds
                else None,
                a.provider if a else None,
                a.model if a else None,
                a.confidence if a else None,
                a.retrieval_mode if a else None,
                a.latency_ms if a else None,
                a.cost_usd if a else None,
                len(p.facts),
                len(p.citations.references),
                len(p.evidence.entries),
                p.tasks.open,
                p.tasks.done,
                "yes" if r.integrity.chain_intact else "NO",
                r.integrity.content_hash_status,
                r.content_hash,
            ]
        )
    _write_grid(
        ws,
        f,
        [
            "Report ref", "Version", "Current", "Asset", "Zone", "Plant",
            "Triggered by", "Origin", "Outcome", "Risk level", "Decided by",
            "Opened at", "Closed at", "Open hours", "Time to decision (min)",
            "Provider", "Model", "Confidence", "Retrieval mode", "Latency ms",
            "Cost USD", "Facts", "Citations", "Evidence entries",
            "Open tasks", "Done tasks", "Chain intact", "Hash status", "Content hash",
        ],
        rows,
        widths=[
            20, 9, 9, 24, 18, 14, 18, 12, 22, 13, 20, 18, 18, 12, 20,
            14, 18, 12, 15, 11, 10, 8, 10, 15, 11, 11, 13, 13, 68,
        ],
        kinds=[
            "text", "text", "text", "text", "text", "text", "text", "text",
            "text", "text", "text", "date", "date", "num", "num", "text",
            "text", "num", "text", "int", "num", "int", "int", "int",
            "int", "int", "text", "text", "mono",
        ],
    )

    # --- Decisions -------------------------------------------------------
    ws = wb.add_worksheet("Decisions")
    _write_grid(
        ws,
        f,
        ["Report ref", "Asset", "Outcome", "Decided by", "Submitted at", "Conditions", "Comments"],
        [
            [
                r.content.meta.report_ref,
                r.content.header.asset.name,
                r.content.decision.outcome_label,
                r.content.decision.decided_by.name if r.content.decision.decided_by else None,
                r.content.decision.submitted_at,
                r.content.decision.conditions,
                r.content.decision.comments,
            ]
            for r in reports
            if r.content.decision
        ],
        widths=[20, 24, 24, 22, 18, 44, 44],
        kinds=["text", "text", "text", "text", "date", "text", "text"],
    )

    # --- Facts -----------------------------------------------------------
    ws = wb.add_worksheet("Facts")
    _write_grid(
        ws,
        f,
        ["Report ref", "Asset", "Zone", "Fact", "Fact type", "Value", "Computed at"],
        [
            [
                r.content.meta.report_ref,
                r.content.header.asset.name,
                r.content.header.asset.zone,
                fact.label,
                fact.fact_type,
                str(fact.value),
                fact.computed_at,
            ]
            for r in reports
            for fact in r.content.facts
        ],
        widths=[20, 24, 18, 46, 26, 14, 18],
        kinds=["text", "text", "text", "text", "text", "text", "date"],
    )

    # --- Citations -------------------------------------------------------
    ws = wb.add_worksheet("Citations")
    _write_grid(
        ws,
        f,
        ["Report ref", "Asset", "Code", "Clause", "Title", "Source", "Cited in summary", "URL"],
        [
            [
                r.content.meta.report_ref,
                r.content.header.asset.name,
                c.code,
                c.clause,
                c.title,
                c.source,
                "yes" if c.cited_in_summary else "no",
                c.source_url,
            ]
            for r in reports
            for c in r.content.citations.references
        ],
        widths=[20, 24, 18, 20, 52, 14, 16, 46],
    )

    # --- Evidence --------------------------------------------------------
    ws = wb.add_worksheet("Evidence")
    _write_grid(
        ws,
        f,
        ["Report ref", "Asset", "Type", "Reading", "Provider", "Valid from", "Confidence"],
        [
            [
                r.content.meta.report_ref,
                r.content.header.asset.name,
                e.category_label,
                e.summary_line,
                e.provider,
                e.valid_from,
                e.confidence,
            ]
            for r in reports
            for e in r.content.evidence.entries
        ],
        widths=[20, 24, 20, 48, 14, 18, 11],
        kinds=["text", "text", "text", "text", "text", "date", "num"],
    )

    wb.close()
    return buf.getvalue()
