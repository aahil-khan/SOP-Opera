"""Assemble the operating-history overview.

One call returns all three aggregates: the page renders them together, and three
round trips for one screen is three chances for a partial render on stage.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.history import repository as repo
from app.history.schemas import (
    CitedAuthority,
    FactTypeCount,
    HistoryOverviewOut,
    VerdictMonth,
)

DEFAULT_WINDOW_MONTHS = 12
AUTHORITY_LIMIT = 8


def _iso(value: object) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


async def build_overview(
    session: AsyncSession, months: int = DEFAULT_WINDOW_MONTHS
) -> HistoryOverviewOut:
    span = await repo.corpus_span(session, months)
    facts = await repo.fact_distribution(session, months)
    verdicts = await repo.verdicts_by_month(session, months)
    authorities = await repo.top_authorities(session, months, AUTHORITY_LIMIT)

    return HistoryOverviewOut(
        window_months=months,
        review_count=span["review_count"] or 0,
        first_review_at=_iso(span["first_review_at"]),
        last_review_at=_iso(span["last_review_at"]),
        fact_distribution=[FactTypeCount(**row) for row in facts],
        verdicts_by_month=[VerdictMonth(**row) for row in verdicts],
        top_authorities=[CitedAuthority(**row) for row in authorities],
    )
