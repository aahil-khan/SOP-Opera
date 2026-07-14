"""Decision request schemas."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from shared.python.schemas import DecisionOutcome


class DecisionIn(BaseModel):
    outcome: DecisionOutcome
    recommendation_dispositions: dict[UUID, Literal["accepted", "rejected"]] = Field(
        default_factory=dict
    )
    conditions: str | None = None

    @model_validator(mode="after")
    def require_conditions_when_needed(self) -> DecisionIn:
        if self.outcome == "approved_with_conditions":
            if not self.conditions or not self.conditions.strip():
                raise ValueError(
                    "conditions is required when outcome is approved_with_conditions"
                )
        return self
