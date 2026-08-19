"""Response shapes for the operating-history views (W11b).

Endpoint-only shapes, so they live here rather than in shared/python/schemas.py —
nothing in the TS contract depends on them beyond the generated client types.
"""

from __future__ import annotations

from pydantic import BaseModel


class FactTypeCount(BaseModel):
    fact_type: str
    count: int


class VerdictMonth(BaseModel):
    """One calendar month. Counts are of *reviews*, keyed by the verdict their
    current assessment landed on."""

    month: str  # YYYY-MM
    nominal: int
    elevated: int
    blocking: int


class CitedAuthority(BaseModel):
    source: str  # "regulations" | "sops"
    label: str  # clause code where one exists, else the title
    citations: int
    reviews: int


class HistoryOverviewOut(BaseModel):
    window_months: int
    review_count: int
    first_review_at: str | None
    last_review_at: str | None
    fact_distribution: list[FactTypeCount]
    verdicts_by_month: list[VerdictMonth]
    top_authorities: list[CitedAuthority]
