"""Assessment job queue status — demo visibility into durable workers."""

from __future__ import annotations

from fastapi import APIRouter

from app.assessment.orchestrator import orchestrator

router = APIRouter(prefix="/api/assessment-jobs", tags=["assessment-jobs"])


@router.get("/queue")
async def get_assessment_queue() -> dict:
    """Pending/generating assessments + worker pool size (hackathon Scalability demo)."""
    return await orchestrator.queue_snapshot()
