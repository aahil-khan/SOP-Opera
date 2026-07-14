"""OpenAI-compatible provider with Structured Outputs (json_schema)."""

from __future__ import annotations

import json
import time
from uuid import UUID

from openai import AsyncOpenAI

from shared.python.schemas import DerivedFact, RetrievedReference

from app.assessment.schemas import AssessmentResult, ProviderGeneration
from app.core.config import get_settings

PROMPT_VERSION = "assessment-v1"

# Rough USD per 1M tokens — used only for observability estimates
_PRICE_PER_1M: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "default": (0.50, 1.50),
}


def _estimate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    pin, pout = _PRICE_PER_1M.get(model, _PRICE_PER_1M["default"])
    return (tokens_in * pin + tokens_out * pout) / 1_000_000.0


def _build_user_prompt(
    derived_facts: list[DerivedFact],
    context_refs: list[UUID],
    retrieved_references: list[RetrievedReference] | None,
    repair_hint: str | None,
) -> str:
    facts = [
        {"fact_type": f.fact_type, "value": f.value, "id": str(f.id)}
        for f in derived_facts
    ]
    refs = []
    for r in retrieved_references or []:
        refs.append(
            {
                "source": r.source,
                "id": str(r.id),
                "retrieval_path": r.retrieval_path,
                "score": r.score,
            }
        )
    payload = {
        "derived_facts": facts,
        "context_entry_ids": [str(c) for c in context_refs],
        "retrieved_references": refs,
        "instructions": (
            "You are an industrial operations risk assessor. "
            "Reason ONLY over the provided derived facts, context refs, and retrieved references. "
            "Produce a concise summary, a risk_level "
            "(nominal|elevated|blocking), confidence 0-1, and at least one recommendation "
            "with text and rationale grounded in the evidence."
        ),
    }
    text = json.dumps(payload, indent=2)
    if repair_hint:
        text += (
            "\n\nPREVIOUS RESPONSE FAILED VALIDATION. Repair instruction: "
            f"{repair_hint}\nReturn a complete valid JSON object matching the schema."
        )
    return text


def _strict_schema(schema: dict) -> dict:
    """Make a Pydantic JSON schema OpenAI Structured Outputs–compatible."""
    defs = schema.get("$defs") or schema.get("definitions") or {}

    def walk(node: dict) -> dict:
        if not isinstance(node, dict):
            return node
        out = dict(node)
        if "$ref" in out:
            return out
        if out.get("type") == "object" or "properties" in out:
            out["additionalProperties"] = False
            props = out.get("properties") or {}
            out["properties"] = {k: walk(v) for k, v in props.items()}
            out["required"] = list(props.keys())
        if "items" in out and isinstance(out["items"], dict):
            out["items"] = walk(out["items"])
        if "anyOf" in out:
            out["anyOf"] = [walk(x) if isinstance(x, dict) else x for x in out["anyOf"]]
        return out

    cleaned = walk(schema)
    if defs:
        key = "$defs" if "$defs" in schema else "definitions"
        cleaned[key] = {name: walk(defn) for name, defn in defs.items()}
    return cleaned


class OpenAICompatibleProvider:
    async def generate_assessment(
        self,
        derived_facts: list[DerivedFact],
        context_refs: list[UUID],
        retrieved_references: list[RetrievedReference] | None,
        *,
        repair_hint: str | None = None,
    ) -> ProviderGeneration:
        settings = get_settings()
        client = AsyncOpenAI(
            api_key=settings.openai_api_key or "no-key",
            base_url=settings.openai_base_url,
        )
        schema = _strict_schema(AssessmentResult.model_json_schema())

        user_prompt = _build_user_prompt(
            derived_facts, context_refs, retrieved_references, repair_hint
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "You produce structured operational risk assessments. "
                    f"Prompt version: {PROMPT_VERSION}."
                ),
            },
            {"role": "user", "content": user_prompt},
        ]
        t0 = time.perf_counter()
        try:
            resp = await client.chat.completions.create(
                model=settings.openai_model,
                messages=messages,
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "AssessmentResult",
                        "strict": True,
                        "schema": schema,
                    },
                },
                temperature=0.2,
            )
        except Exception:
            # Fallback for providers that lack strict json_schema support
            resp = await client.chat.completions.create(
                model=settings.openai_model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.2,
            )
        latency_ms = int((time.perf_counter() - t0) * 1000)
        content = resp.choices[0].message.content or ""
        result = AssessmentResult.model_validate_json(content)

        usage = resp.usage
        tokens_in = int(usage.prompt_tokens) if usage else 0
        tokens_out = int(usage.completion_tokens) if usage else 0
        return ProviderGeneration(
            result=result,
            provider="openai_compatible",
            model=settings.openai_model,
            input_tokens=tokens_in,
            output_tokens=tokens_out,
            estimated_cost_usd=_estimate_cost(
                settings.openai_model, tokens_in, tokens_out
            ),
            latency_ms=latency_ms,
        )
