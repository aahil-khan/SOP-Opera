"""Ollama provider — JSON mode + explicit Pydantic validation."""

from __future__ import annotations

import json
import time
from uuid import UUID

import httpx

from shared.python.schemas import DerivedFact, RetrievedReference

from app.assessment.providers.openai_compatible import _build_user_prompt
from app.assessment.schemas import AssessmentResult, ProviderGeneration
from app.core.config import get_settings

PROMPT_VERSION = "assessment-v1-ollama"


class OllamaProvider:
    async def generate_assessment(
        self,
        derived_facts: list[DerivedFact],
        context_refs: list[UUID],
        retrieved_references: list[RetrievedReference] | None,
        *,
        repair_hint: str | None = None,
    ) -> ProviderGeneration:
        settings = get_settings()
        user_prompt = _build_user_prompt(
            derived_facts, context_refs, retrieved_references, repair_hint
        )
        schema_hint = json.dumps(AssessmentResult.model_json_schema(), indent=2)
        system = (
            "You produce structured operational risk assessments as JSON only. "
            f"Prompt version: {PROMPT_VERSION}. "
            "Match this JSON schema exactly:\n"
            f"{schema_hint}"
        )

        payload = {
            "model": settings.ollama_model,
            "stream": False,
            "format": "json",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            "options": {"temperature": 0.2},
        }

        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{settings.ollama_base_url.rstrip('/')}/api/chat",
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
        latency_ms = int((time.perf_counter() - t0) * 1000)

        content = (data.get("message") or {}).get("content") or ""
        result = AssessmentResult.model_validate_json(content)

        # Ollama may include eval counts
        tokens_in = int(data.get("prompt_eval_count") or 0)
        tokens_out = int(data.get("eval_count") or 0)
        return ProviderGeneration(
            result=result,
            provider="ollama",
            model=settings.ollama_model,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            estimated_cost_usd=0.0,
            latency_ms=latency_ms,
        )
