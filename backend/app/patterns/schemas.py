"""Response shapes for pattern discovery (W13). Endpoint-only."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PatternOut(BaseModel):
    key: str
    family: str
    claim: str
    """The finding in plain words — the headline a supervisor reads."""

    hits: int
    trials: int
    rate: float
    base_rate: float
    ratio: float
    """How much more often than the base rate. 'lift', said in English."""

    why_no_rule: str
    covered_by: str | None = None
    review_ids: list[str] = Field(default_factory=list)

    state: str = "candidate"  # candidate | ratified | dismissed
    decided_by: str | None = None
    decided_at: str | None = None
    note: str | None = None


class MinedScopeOut(BaseModel):
    """What was searched. A statistic without its denominator cannot be checked."""

    window_months: int
    review_count: int
    asset_count: int
    first_review_at: str | None
    last_review_at: str | None
    min_support: int
    min_ratio: float
    alpha: float


class PatternsOut(BaseModel):
    scope: MinedScopeOut
    patterns: list[PatternOut]
    corpus_is_seeded: bool
    """Drives the in-product 'demonstration corpus' label (W11c)."""


class VerdictIn(BaseModel):
    note: str | None = None
