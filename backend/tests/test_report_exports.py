"""
PDF and Excel rendering — pure functions over a hydrated packet, no database.

Asserted structurally (magic bytes, zip members, sheet names, pane/filter markup)
rather than visually: the point is that the files are well-formed and carry the
sections an auditor expects, which is checkable without opening Excel.
"""

from __future__ import annotations

import io
import re
import zipfile
from datetime import datetime, timezone
from uuid import uuid4

from app.reports.export_pdf import render_report_pdf
from app.reports.export_xlsx import render_dataset_xlsx, render_report_xlsx
from app.reports.packet import PacketMeta, hydrate_packet
from app.reports.schemas import ReportIntegrity, ReportOut

from tests.report_fixtures import make_packet, make_report

EXPECTED_SHEETS = [
    "Summary",
    "Decision",
    "Evidence",
    "Facts",
    "Citations",
    "Recommendations",
    "Tasks",
    "Audit trail",
]


def _sheet_names(data: bytes) -> list[str]:
    z = zipfile.ZipFile(io.BytesIO(data))
    names = re.findall(r'<sheet name="([^"]+)"', z.read("xl/workbook.xml").decode())
    return names


def test_pdf_is_a_well_formed_document():
    pdf = render_report_pdf(make_report())
    assert pdf.startswith(b"%PDF-")
    assert pdf.rstrip().endswith(b"%%EOF")
    # A packet with evidence, citations, tasks and an audit trail is several
    # pages; a near-empty PDF would mean the flowables were silently dropped.
    assert len(pdf) > 2000


def test_xlsx_has_one_sheet_per_packet_section():
    data = render_report_xlsx(make_report())
    z = zipfile.ZipFile(io.BytesIO(data))
    assert z.testzip() is None
    assert _sheet_names(data) == EXPECTED_SHEETS


def test_xlsx_sheets_are_frozen_and_filterable():
    """Frozen header row + autofilter is what makes this usable as a dataset."""
    data = render_report_xlsx(make_report())
    z = zipfile.ZipFile(io.BytesIO(data))
    evidence_sheet = z.read("xl/worksheets/sheet3.xml").decode()
    assert "<pane" in evidence_sheet
    assert "autoFilter" in evidence_sheet


def test_dataset_export_covers_every_report():
    reports = [make_report(), make_report()]
    data = render_dataset_xlsx(reports)
    assert zipfile.ZipFile(io.BytesIO(data)).testzip() is None
    assert _sheet_names(data) == [
        "Reports",
        "Decisions",
        "Facts",
        "Citations",
        "Evidence",
    ]


def test_dataset_export_of_nothing_still_produces_headers():
    data = render_dataset_xlsx([])
    assert zipfile.ZipFile(io.BytesIO(data)).testzip() is None
    assert "Reports" in _sheet_names(data)


def _legacy_report() -> ReportOut:
    legacy_content = {
        "title": "Closure Report — Vessel A (blocked)",
        "asset": {"id": str(uuid4()), "name": "Vessel A", "zone": "tank-farm",
                  "plant_id": "VSP-1", "floor": "ground"},
        "assessment_snapshot": {"id": str(uuid4()), "risk_level": "blocking",
                                "summary": "Old summary", "version": 1,
                                "recommendations": [], "metadata": {}},
        "decision": {"id": str(uuid4()), "outcome": "blocked",
                     "submitted_at": "2026-01-01T00:00:00+00:00"},
        "evidence": {"id": str(uuid4()), "frozen_context_ids": [str(uuid4())]},
        "review": {"state": "closed"},
    }
    now = datetime.now(timezone.utc)
    row = {
        "id": uuid4(), "review_id": uuid4(), "closure_event_seq": 1,
        "packet_version": 1, "generated_at": now, "frozen_at": now,
        "closed_by": None, "content_hash": None, "is_current": True,
    }
    packet = hydrate_packet(legacy_content, row=row)
    return ReportOut(
        id=row["id"], review_id=row["review_id"], closure_event_seq=1,
        version_label="v1", is_current=True, packet_version=1,
        generated_at=now, frozen_at=now, content=packet,
        integrity=ReportIntegrity(content_hash_status="not_recorded"),
    )


def test_exporters_render_a_legacy_packet_without_raising():
    """
    Old rows must still export. Silently emitting an empty Evidence table would
    be the worst outcome for an audit document, so the PDF carries a banner.
    """
    report = _legacy_report()

    pdf = render_report_pdf(report)
    assert pdf.startswith(b"%PDF-")

    data = render_report_xlsx(report)
    assert zipfile.ZipFile(io.BytesIO(data)).testzip() is None
    assert _sheet_names(data) == EXPECTED_SHEETS


def test_pdf_reports_a_broken_chain_rather_than_hiding_it():
    report = make_report()
    report.integrity.chain_intact = False
    report.integrity.chain_breaks = [{"seq": 12, "reason": "content_altered"}]
    pdf = render_report_pdf(report)
    assert pdf.startswith(b"%PDF-")
