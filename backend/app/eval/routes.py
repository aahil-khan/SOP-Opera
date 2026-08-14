"""Eval harness HTTP surface — deterministic, no DB."""

from __future__ import annotations

import threading

from fastapi import APIRouter

from app.eval.schemas import EvalSummaryOut
from app.eval.service import build_eval_summary

router = APIRouter(prefix="/api/eval", tags=["eval"])

# The harness is a CPU-bound full-dataset run. A sync route keeps it off the
# event loop (FastAPI runs it in the threadpool), and the lock serializes
# concurrent "Run now" clicks so a judge cannot double-fire it into N parallel
# dataset builds — the second click simply waits for the run in flight.
_run_lock = threading.Lock()


@router.get("/summary", response_model=EvalSummaryOut)
def get_eval_summary() -> EvalSummaryOut:
    """Run the labeled compound vs single-sensor harness and return headline metrics."""
    with _run_lock:
        return build_eval_summary()
