from __future__ import annotations

from fastapi import APIRouter

from app.config.schemas import ThresholdsConfigIn, ThresholdsConfigOut
from app.config.service import apply_threshold_updates, build_thresholds_config

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/thresholds", response_model=ThresholdsConfigOut)
async def get_thresholds() -> ThresholdsConfigOut:
    """Effective sensor bands and rule thresholds (from env / Settings)."""
    return build_thresholds_config()


@router.put("/thresholds", response_model=ThresholdsConfigOut)
async def put_thresholds(body: ThresholdsConfigIn) -> ThresholdsConfigOut:
    """
    Demo tuning: patch thresholds in-process (env overrides + Settings cache clear).

    Affects subsequent derived-fact evaluation and GET responses for this API process.
    Does not rewrite .env on disk.
    """
    return apply_threshold_updates(body)
