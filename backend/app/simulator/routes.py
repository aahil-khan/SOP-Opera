"""Demo Mode HTTP endpoints — start / reset / list / status."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.simulator.dsl import ScenarioNotFoundError, list_scenarios
from app.simulator.engine import (
    ScenarioAlreadyRunningError,
    demo_controller,
)

router = APIRouter(prefix="/demo", tags=["demo"])


@router.get("/scenarios")
async def get_scenarios() -> list[dict]:
    return [
        {
            "name": s.name,
            "label": s.label,
            "description": s.description.strip(),
            "step_count": len(s.steps),
        }
        for s in list_scenarios()
    ]


@router.post("/scenarios/{name}/start", status_code=202)
async def start_scenario(name: str) -> dict:
    try:
        return await demo_controller.start(name)
    except ScenarioNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ScenarioAlreadyRunningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/reset")
async def reset_demo() -> dict:
    return await demo_controller.reset()


@router.get("/status")
async def demo_status() -> dict:
    return demo_controller.status()
