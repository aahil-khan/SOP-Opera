"""Pattern-discovery HTTP surface (W13)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.routes import get_current_actor
from app.auth.schemas import ActorMeOut
from app.db.session import get_session
from app.patterns.schemas import PatternOut, PatternsOut, VerdictIn
from app.patterns.service import (
    DEFAULT_WINDOW_MONTHS,
    PatternError,
    build_view,
    record_verdict,
)

router = APIRouter(prefix="/api/patterns", tags=["patterns"])


@router.get("", response_model=PatternsOut)
async def get_patterns(
    months: int = Query(DEFAULT_WINDOW_MONTHS, ge=1, le=60),
    session: AsyncSession = Depends(get_session),
) -> PatternsOut:
    """
    Patterns mined from closed history, with what was searched to find them.

    Recomputed per request rather than cached: the corpus is the evidence, and a
    cached claim is a claim nobody can check against it.
    """
    return await build_view(session, months)


@router.post("/{pattern_key:path}/ratify", response_model=PatternOut)
async def post_ratify(
    pattern_key: str,
    body: VerdictIn | None = None,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> PatternOut:
    """
    Accept a pattern as a watch item. Always a human act.

    Recorded and audited; it does not change what the plant blocks on. The gate
    stays in risk/policy.py where every other verdict is decided.
    """
    try:
        return await record_verdict(
            session,
            pattern_key=pattern_key,
            state="ratified",
            actor=actor.name,
            note=(body.note if body else None),
        )
    except PatternError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{pattern_key:path}/dismiss", response_model=PatternOut)
async def post_dismiss(
    pattern_key: str,
    body: VerdictIn | None = None,
    actor: ActorMeOut = Depends(get_current_actor),
    session: AsyncSession = Depends(get_session),
) -> PatternOut:
    """Set a pattern aside. Also a human act, and also on the record."""
    try:
        return await record_verdict(
            session,
            pattern_key=pattern_key,
            state="dismissed",
            actor=actor.name,
            note=(body.note if body else None),
        )
    except PatternError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
