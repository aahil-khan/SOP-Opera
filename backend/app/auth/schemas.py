from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


ActorKind = Literal["user", "worker"]


class RosterEntryOut(BaseModel):
    id: UUID
    kind: ActorKind
    name: str
    role: str
    owned_zones: list[str] = Field(default_factory=list)


class ActorMeOut(BaseModel):
    id: UUID
    kind: ActorKind
    name: str
    role: str
    owned_zones: list[str] = Field(default_factory=list)


class LoginIn(BaseModel):
    actor_id: UUID

