"""AgentStep event schema + WebSocket broadcast helper."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.realtime.connection_manager import manager

AgentName = Literal[
    "scada",
    "permit",
    "maintenance",
    "workforce",
    "spatial",
    "orchestrator",
    "incident_pattern",
    "shift_handover",
]

AgentStepKind = Literal[
    "started",
    "tool_call",
    "observation",
    "local_risk",
    "verdict",
    "completed",
    "error",
]

AgentFinding = Literal["risk", "clearance", "neutral"]


class AgentStep(BaseModel):
    """One visible reasoning step from an agent — streamed to the Brain panel."""

    agent: AgentName
    kind: AgentStepKind
    message: str
    review_id: str | None = None
    assessment_id: str | None = None
    finding: AgentFinding = "neutral"
    detail: dict[str, Any] = Field(default_factory=dict)
    ts: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


async def broadcast_agent_step(step: AgentStep) -> None:
    await manager.broadcast("agent.step", step.model_dump())


def make_step(
    agent: AgentName,
    kind: AgentStepKind,
    message: str,
    *,
    review_id: UUID | str | None = None,
    assessment_id: UUID | str | None = None,
    detail: dict[str, Any] | None = None,
    finding: AgentFinding = "neutral",
) -> AgentStep:
    return AgentStep(
        agent=agent,
        kind=kind,
        message=message,
        review_id=str(review_id) if review_id else None,
        assessment_id=str(assessment_id) if assessment_id else None,
        finding=finding,
        detail=detail or {},
    )
