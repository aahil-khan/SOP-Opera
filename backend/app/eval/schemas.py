"""Pydantic models for eval API responses."""

from __future__ import annotations

from pydantic import BaseModel, Field


class DetectorSummaryOut(BaseModel):
    name: str
    accuracy: float
    recall: float
    false_negative_rate: float
    precision: float
    tp: int
    fp: int
    tn: int
    fn: int


class EvalSummaryOut(BaseModel):
    """Judge-facing compound vs single-sensor headline metrics."""

    fn_reduction_pct: float
    hero_case_id: str

    # Lead time is plant process time (from scenario `t_offset_minutes`), not
    # simulator playback pacing.
    hero_lead_time_minutes: float | None = None
    hero_t_forecast_minutes: float | None = None
    hero_t_compound_minutes: float | None = None
    hero_t_single_sensor_minutes: float | None = None

    single_sensor: DetectorSummaryOut
    forecast: DetectorSummaryOut
    compound: DetectorSummaryOut
    case_count: int = Field(ge=0)
    positive_count: int = Field(default=0, ge=0)
    """Cases where a statutory stop-work provision applies."""
    compound_only_catch_count: int = Field(ge=0)
    label_basis: str = (
        "Statutory stop-work criteria (Factories Act 1948 s.37(1), s.41H, s.36(2); "
        "OISD-STD-105), evaluated independently of the risk policy."
    )

    # Regulatory compliance coverage — previously the only scored claim with no metric.
    regulation_coverage_pct: float = 0.0
    statutory_coverage_pct: float = 0.0
    coverage_by_standard: dict[str, int] = Field(default_factory=dict)
