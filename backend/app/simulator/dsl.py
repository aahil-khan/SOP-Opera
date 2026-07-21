"""YAML Scenario DSL — pydantic models + loader (TDS §5.6).

Steps mirror the POST /context contract (asset/category/payload/confidence)
so there is no type→category translation layer to maintain.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import UUID

import yaml
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"


class ScenarioNotFoundError(LookupError):
    """Raised when a scenario YAML file cannot be found or fails validation."""


class ScenarioStep(BaseModel):
    asset: str  # UUID string OR seeded asset name (resolved at emit time)
    category: str
    payload: dict[str, Any]
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    delay_seconds: float | None = None  # None → settings.simulator_default_step_delay_seconds
    valid_for_hours: float = 4.0
    t_offset_minutes: float | None = None
    """
    Physical process time of this step, in minutes from scenario start.

    Distinct from `delay_seconds`, which is demo playback pacing. A gas excursion
    that develops over 30 minutes of plant time is replayed in ~30 seconds; only
    `t_offset_minutes` is meaningful for lead-time measurement.
    """


class ScenarioFile(BaseModel):
    name: str
    label: str
    description: str = ""
    steps: list[ScenarioStep] = Field(min_length=1)


def list_scenario_names() -> list[str]:
    if not SCENARIOS_DIR.is_dir():
        return []
    return sorted(p.stem for p in SCENARIOS_DIR.glob("*.yaml"))


def load_scenario(name: str) -> ScenarioFile:
    """Load and validate a scenario YAML. Raises ScenarioNotFoundError."""
    # Prevent path traversal — only bare names under scenarios/
    if "/" in name or "\\" in name or name != Path(name).name:
        raise ScenarioNotFoundError(f"Invalid scenario name: {name!r}")
    path = SCENARIOS_DIR / f"{name}.yaml"
    if not path.is_file():
        raise ScenarioNotFoundError(f"Scenario not found: {name}")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        scenario = ScenarioFile.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise ScenarioNotFoundError(
            f"Scenario {name!r} failed validation: {exc}"
        ) from exc
    if scenario.name != name:
        # Allow label/display name to differ, but enforce filename == name for routing.
        raise ScenarioNotFoundError(
            f"Scenario file {name!r} declares name={scenario.name!r}; they must match"
        )
    return scenario


def list_scenarios() -> list[ScenarioFile]:
    out: list[ScenarioFile] = []
    for name in list_scenario_names():
        try:
            out.append(load_scenario(name))
        except ScenarioNotFoundError:
            continue
    return out


async def resolve_asset_id(session: AsyncSession, asset: str) -> UUID:
    """
    Resolve a step's `asset` field to a UUID.
    Accepts a UUID string directly, otherwise looks up assets by name (case-insensitive).
    """
    try:
        return UUID(asset)
    except ValueError:
        pass

    result = await session.execute(
        text(
            """
            SELECT id FROM assets
            WHERE lower(name) = lower(:name)
            LIMIT 1
            """
        ),
        {"name": asset},
    )
    row = result.first()
    if row is None:
        raise LookupError(f"Asset not found: {asset!r}")
    return row._mapping["id"]
