"""Demo Mode HTTP endpoints — start / reset / list / status / random."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.simulator.dsl import ScenarioNotFoundError, list_scenarios
from app.simulator.engine import (
    ScenarioAlreadyRunningError,
    demo_controller,
)
from app.simulator.random_engine import RandomModeConfig, default_config_from_settings

router = APIRouter(prefix="/demo", tags=["demo"])


class RandomStartBody(BaseModel):
    max_concurrent_issues: int | None = Field(default=None, ge=1, le=40)
    spawn_interval_min_seconds: float | None = Field(default=None, ge=0.5)
    spawn_interval_max_seconds: float | None = Field(default=None, ge=0.5)
    compound_probability: float | None = Field(default=None, ge=0.0, le=1.0)
    seed: int | None = None
    floors: list[str] | None = None
    signal_weights: dict[str, float] | None = None
    issue_cap: int | None = Field(default=None, ge=1)
    valid_for_hours: float | None = Field(default=None, gt=0)


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


@router.get("/sources")
async def get_demo_sources() -> list[dict]:
    """Independent plant-system simulators coordinated by the Orchestrator Sim."""
    from app.simulator.sources import list_sources

    return list_sources()


@router.get("/ambient")
async def get_ambient_status() -> dict:
    from app.simulator.ambient import ambient_loop

    return ambient_loop.status()


@router.get("/telemetry/recent")
async def get_recent_telemetry(
    per_asset: int = 30,
    asset_id: str | None = None,
) -> dict:
    """Soft ambient samples for chart hydration (oldest→newest per asset)."""
    from uuid import UUID

    from app.db.session import SessionLocal
    from app.simulator.telemetry_store import list_recent_samples

    aid: UUID | None = None
    if asset_id:
        try:
            aid = UUID(asset_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="invalid asset_id") from exc

    async with SessionLocal() as session:
        samples = await list_recent_samples(
            session, per_asset=per_asset, asset_id=aid
        )
    return {"samples": samples, "count": len(samples)}


@router.post("/ambient/start", status_code=202)
async def start_ambient() -> dict:
    from app.simulator.ambient import ambient_loop

    ambient_loop.start()
    return ambient_loop.status()


@router.post("/ambient/stop")
async def stop_ambient() -> dict:
    from app.simulator.ambient import ambient_loop

    await ambient_loop.stop()
    return ambient_loop.status()


@router.post("/scenarios/{name}/start", status_code=202)
async def start_scenario(name: str) -> dict:
    try:
        return await demo_controller.start(name)
    except ScenarioNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ScenarioAlreadyRunningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/random/start", status_code=202)
async def start_random(body: RandomStartBody | None = None) -> dict:
    base = default_config_from_settings().model_dump()
    if body is not None:
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        base.update(patch)
    try:
        config = RandomModeConfig.model_validate(base)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        return await demo_controller.start_random(config)
    except ScenarioAlreadyRunningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/reset")
async def reset_demo() -> dict:
    return await demo_controller.reset()


@router.get("/status")
async def demo_status() -> dict:
    return demo_controller.status()
