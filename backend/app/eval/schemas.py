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
    hero_lead_time_seconds: float | None = None
    hero_t_forecast_seconds: float | None = None
    hero_t_compound_seconds: float | None = None
    hero_t_single_sensor_seconds: float | None = None
    single_sensor: DetectorSummaryOut
    forecast: DetectorSummaryOut
    compound: DetectorSummaryOut
    case_count: int = Field(ge=0)
    compound_only_catch_count: int = Field(ge=0)
