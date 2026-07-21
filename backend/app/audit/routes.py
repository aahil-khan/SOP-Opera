"""Audit trail integrity surface."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import verify_audit_chain
from app.db.session import get_session

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/verify")
async def verify_chain(
    entity_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Recompute the audit hash chain and report any tampering.

    Verification always runs over the whole chain; `entity_id` only narrows which
    breaks are reported, because a subset of entries cannot be verified alone.
    """
    verification = await verify_audit_chain(session, entity_id=entity_id)
    return verification.as_dict()
