from __future__ import annotations

from fastapi import APIRouter

from app.config.schemas import ThresholdsConfigOut
from app.config.service import build_thresholds_config

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/thresholds", response_model=ThresholdsConfigOut)
async def get_thresholds() -> ThresholdsConfigOut:
    """Read-only effective sensor bands and rule thresholds (from env / Settings)."""
    return build_thresholds_config()
