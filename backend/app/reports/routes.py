from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.reports.service import get_report, list_reports

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("")
async def get_reports(session: AsyncSession = Depends(get_session)) -> list[dict]:
    return await list_reports(session)


@router.get("/{report_id}")
async def get_report_by_id(
    report_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    report = await get_report(session, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return report
