"""Eval harness HTTP surface — deterministic, no DB."""

from __future__ import annotations

from fastapi import APIRouter

from app.eval.schemas import EvalSummaryOut
from app.eval.service import build_eval_summary

router = APIRouter(prefix="/api/eval", tags=["eval"])


@router.get("/summary", response_model=EvalSummaryOut)
async def get_eval_summary() -> EvalSummaryOut:
    """Run the labeled compound vs single-sensor harness and return headline metrics."""
    return build_eval_summary()
