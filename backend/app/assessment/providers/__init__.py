"""AI provider selection."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from shared.python.schemas import DerivedFact, RetrievedReference

from app.assessment.schemas import ProviderGeneration
from app.core.config import get_settings


class AIProvider(Protocol):
    async def generate_assessment(
        self,
        derived_facts: list[DerivedFact],
        context_refs: list[UUID],
        retrieved_references: list[RetrievedReference] | None,
        *,
        repair_hint: str | None = None,
    ) -> ProviderGeneration: ...


def get_provider(name: str | None = None) -> AIProvider:
    settings = get_settings()
    key = (name or settings.ai_provider or "mock").lower()
    if key in ("openai_compatible", "openai"):
        from app.assessment.providers.openai_compatible import OpenAICompatibleProvider

        return OpenAICompatibleProvider()
    if key == "ollama":
        from app.assessment.providers.ollama import OllamaProvider

        return OllamaProvider()
    from app.assessment.providers.mock import MockProvider

    return MockProvider()
