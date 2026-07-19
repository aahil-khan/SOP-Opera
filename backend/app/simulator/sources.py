"""Per-source plant simulators — SCADA / PTW / Maintenance / Workforce.

Each source owns a slice of context categories and emits through the same
ContextProvider seam as Manual Input. The OrchestratorSim coordinates them.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.context.schemas import ContextIn, ContextIngestResult
from app.realtime.connection_manager import manager
from app.simulator.dsl import ScenarioStep, resolve_asset_id
from app.simulator.provider import SimulatorProvider

# category → independent plant system (mirrors multi-agent domains)
CATEGORY_TO_SOURCE: dict[str, str] = {
    "sensor": "scada",
    "weather": "scada",
    "permit": "ptw",
    "lift_plan": "ptw",
    "isolation_status": "maintenance",
    "worker_location": "workforce",
    "certification": "workforce",
    "ppe_status": "workforce",
}

SOURCE_LABELS: dict[str, str] = {
    "scada": "SCADA Simulator",
    "ptw": "PTW / Permit Simulator",
    "maintenance": "Maintenance Simulator",
    "workforce": "Workforce Simulator",
}


@dataclass
class SourceEmitResult:
    source: str
    category: str
    asset_id: UUID
    ingest: ContextIngestResult


class SourceSimulator(Protocol):
    name: str

    async def emit(
        self,
        session: AsyncSession,
        *,
        asset_id: UUID,
        category: str,
        payload: dict[str, Any],
        confidence: float,
        valid_for_hours: float,
        now: datetime | None = None,
    ) -> SourceEmitResult: ...


class BaseSourceSimulator:
    name: str = "unknown"

    async def emit(
        self,
        session: AsyncSession,
        *,
        asset_id: UUID,
        category: str,
        payload: dict[str, Any],
        confidence: float,
        valid_for_hours: float,
        now: datetime | None = None,
    ) -> SourceEmitResult:
        now = now or datetime.now(timezone.utc)
        body = ContextIn(
            asset_id=asset_id,
            category=category,
            payload=payload,
            provider=f"simulator:{self.name}",
            valid_from=now,
            valid_until=now + timedelta(hours=valid_for_hours),
            confidence=confidence,
        )
        ingest = await SimulatorProvider(session).emit(body)
        result = SourceEmitResult(
            source=self.name,
            category=category,
            asset_id=asset_id,
            ingest=ingest,
        )
        ts = now.isoformat()
        await manager.broadcast(
            "sim.source_emit",
            {
                "source": self.name,
                "label": SOURCE_LABELS.get(self.name, self.name),
                "category": category,
                "asset_id": str(asset_id),
                "payload": payload,
                "ts": ts,
                "review_id": (
                    str(ingest.review.id) if ingest.review else None
                ),
                "derived_facts": [f.fact_type for f in ingest.derived_facts],
                "message": (
                    f"[{SOURCE_LABELS.get(self.name, self.name)}] emitted "
                    f"{category} → facts={ [f.fact_type for f in ingest.derived_facts] or 'none' }"
                ),
            },
        )
        return result


class ScadaSimulator(BaseSourceSimulator):
    name = "scada"


class PtwSimulator(BaseSourceSimulator):
    name = "ptw"


class MaintenanceSimulator(BaseSourceSimulator):
    name = "maintenance"


class WorkforceSimulator(BaseSourceSimulator):
    name = "workforce"


SOURCES: dict[str, BaseSourceSimulator] = {
    "scada": ScadaSimulator(),
    "ptw": PtwSimulator(),
    "maintenance": MaintenanceSimulator(),
    "workforce": WorkforceSimulator(),
}


def source_for_category(category: str) -> BaseSourceSimulator:
    key = CATEGORY_TO_SOURCE.get(category, "scada")
    return SOURCES[key]


def list_sources() -> list[dict[str, Any]]:
    by_source: dict[str, list[str]] = {k: [] for k in SOURCES}
    for cat, src in CATEGORY_TO_SOURCE.items():
        by_source.setdefault(src, []).append(cat)
    return [
        {
            "name": name,
            "label": SOURCE_LABELS[name],
            "categories": sorted(by_source.get(name, [])),
        }
        for name in ("scada", "ptw", "maintenance", "workforce")
    ]


class OrchestratorSim:
    """
    Coordinates independent source simulators for a scripted scenario.
    Mirrors the multi-agent Orchestrator: sources don't talk to each other —
    only this coordinator sequences them into a compound story.
    """

    def __init__(self) -> None:
        self.last_sources: list[str] = []

    async def emit_direct(
        self,
        session: AsyncSession,
        *,
        asset_name: str,
        category: str,
        payload: dict[str, Any],
        confidence: float = 1.0,
        valid_for_hours: float = 4.0,
        step_index: int = 0,
        total_steps: int = 1,
    ) -> SourceEmitResult:
        """Emit a single context step (used by Random Mode / ambient)."""
        step = ScenarioStep(
            asset=asset_name,
            category=category,
            payload=payload,
            confidence=confidence,
            delay_seconds=0,
            valid_for_hours=valid_for_hours,
        )
        return await self.run_step(
            session,
            step,
            step_index=step_index,
            total_steps=total_steps,
        )

    async def run_step(
        self,
        session: AsyncSession,
        step: ScenarioStep,
        *,
        step_index: int,
        total_steps: int,
    ) -> SourceEmitResult:
        asset_id = await resolve_asset_id(session, step.asset)
        source = source_for_category(step.category)
        await manager.broadcast(
            "sim.orchestrator",
            {
                "message": (
                    f"[Orchestrator Sim] routing step {step_index + 1}/{total_steps} "
                    f"({step.category} @ {step.asset}) → {SOURCE_LABELS[source.name]}"
                ),
                "step_index": step_index,
                "total_steps": total_steps,
                "source": source.name,
                "category": step.category,
                "asset": step.asset,
            },
        )
        result = await source.emit(
            session,
            asset_id=asset_id,
            category=step.category,
            payload=step.payload,
            confidence=step.confidence,
            valid_for_hours=step.valid_for_hours,
        )
        self.last_sources.append(source.name)
        return result
