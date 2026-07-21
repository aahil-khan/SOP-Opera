from __future__ import annotations

import re
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.db.session import get_session
from app.reports.export_pdf import render_report_pdf
from app.reports.export_xlsx import render_dataset_xlsx, render_report_xlsx
from app.reports.schemas import ReportOut, ReportSummaryOut
from app.reports.service import get_report, list_reports, load_packets

router = APIRouter(prefix="/reports", tags=["reports"])

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)


def _slug(value: str) -> str:
    """ASCII-only filename component, so no RFC 5987 `filename*` dance is needed."""
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", value or "").strip("-").lower()
    return (cleaned or "report")[:40]


def _download(data: bytes, *, filename: str, media_type: str) -> Response:
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("", response_model=list[ReportSummaryOut])
async def get_reports(
    review_id: UUID | None = None,
    outcome: str | None = None,
    risk_level: str | None = None,
    include_superseded: bool = False,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
) -> list[ReportSummaryOut]:
    return await list_reports(
        session,
        review_id=review_id,
        outcome=outcome,
        risk_level=risk_level,
        include_superseded=include_superseded,
        limit=limit,
        offset=offset,
    )


# Declared before /{report_id}: FastAPI matches in definition order, so the
# parameterised route would otherwise swallow this path and 422 on UUID parsing.
@router.get("/export.xlsx")
async def export_all_reports_xlsx(
    include_superseded: bool = False,
    session: AsyncSession = Depends(get_session),
) -> Response:
    reports = await load_packets(session, include_superseded=include_superseded)
    # Both renderers are synchronous and CPU-bound; the event loop also drives the
    # websocket broadcast fan-out, so keep them off it.
    data = await run_in_threadpool(render_dataset_xlsx, reports)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return _download(
        data,
        filename=f"sop-opera-reports-{stamp}.xlsx",
        media_type=XLSX_MEDIA_TYPE,
    )


@router.get("/{report_id}", response_model=ReportOut)
async def get_report_by_id(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> ReportOut:
    report = await get_report(session, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return report


@router.get("/{report_id}/export.pdf")
async def export_report_pdf(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    report = await get_report(session, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    data = await run_in_threadpool(render_report_pdf, report)
    name = _slug(f"{report.content.meta.report_ref}-{report.content.header.asset.name}")
    return _download(data, filename=f"{name}.pdf", media_type="application/pdf")


@router.get("/{report_id}/export.xlsx")
async def export_report_xlsx(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> Response:
    report = await get_report(session, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    data = await run_in_threadpool(render_report_xlsx, report)
    name = _slug(f"{report.content.meta.report_ref}-{report.content.header.asset.name}")
    return _download(data, filename=f"{name}.xlsx", media_type=XLSX_MEDIA_TYPE)
