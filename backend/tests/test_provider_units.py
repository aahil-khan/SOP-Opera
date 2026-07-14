"""Unit tests for the OpenAI-compatible and Ollama providers, with the network
boundary mocked out. No live API keys / servers required.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest

from app.assessment.providers.ollama import OllamaProvider
from app.assessment.providers.openai_compatible import OpenAICompatibleProvider
from app.assessment.schemas import ProviderGeneration
from shared.python.schemas import DerivedFact

VALID_RESULT_JSON = json.dumps(
    {
        "summary": "Elevated gas near active hot work; escalate before proceeding.",
        "risk_level": "blocking",
        "recommendations": [
            {
                "text": "Evacuate zone and retest atmosphere",
                "rationale": "Gas reading exceeds threshold near ignition source",
            }
        ],
        "confidence": 0.9,
    }
)


def _fact() -> DerivedFact:
    return DerivedFact(
        id=uuid4(),
        asset_id=uuid4(),
        fact_type="elevated_gas",
        value=True,
        source_context_ids=[],
        computed_at="2026-07-14T00:00:00+00:00",
    )


@pytest.mark.asyncio
async def test_openai_compatible_provider_parses_structured_output(monkeypatch):
    class FakeCompletions:
        async def create(self, **kwargs):
            message = SimpleNamespace(content=VALID_RESULT_JSON)
            choice = SimpleNamespace(message=message)
            usage = SimpleNamespace(prompt_tokens=120, completion_tokens=40)
            return SimpleNamespace(choices=[choice], usage=usage)

    class FakeChat:
        def __init__(self) -> None:
            self.completions = FakeCompletions()

    class FakeAsyncOpenAI:
        def __init__(self, *args, **kwargs) -> None:
            self.chat = FakeChat()

    monkeypatch.setattr(
        "app.assessment.providers.openai_compatible.AsyncOpenAI", FakeAsyncOpenAI
    )

    provider = OpenAICompatibleProvider()
    generation = await provider.generate_assessment([_fact()], [], None)

    assert isinstance(generation, ProviderGeneration)
    assert generation.provider == "openai_compatible"
    assert generation.result.risk_level == "blocking"
    assert generation.result.recommendations
    assert generation.input_tokens == 120
    assert generation.output_tokens == 40
    assert generation.estimated_cost_usd > 0


@pytest.mark.asyncio
async def test_openai_compatible_provider_falls_back_when_json_schema_unsupported(
    monkeypatch,
):
    calls: list[dict] = []

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            if kwargs.get("response_format", {}).get("type") == "json_schema":
                raise RuntimeError("model does not support structured outputs")
            message = SimpleNamespace(content=VALID_RESULT_JSON)
            choice = SimpleNamespace(message=message)
            usage = SimpleNamespace(prompt_tokens=10, completion_tokens=10)
            return SimpleNamespace(choices=[choice], usage=usage)

    class FakeChat:
        def __init__(self) -> None:
            self.completions = FakeCompletions()

    class FakeAsyncOpenAI:
        def __init__(self, *args, **kwargs) -> None:
            self.chat = FakeChat()

    monkeypatch.setattr(
        "app.assessment.providers.openai_compatible.AsyncOpenAI", FakeAsyncOpenAI
    )

    provider = OpenAICompatibleProvider()
    generation = await provider.generate_assessment([_fact()], [], None)

    assert len(calls) == 2
    assert calls[1]["response_format"] == {"type": "json_object"}
    assert generation.result.risk_level == "blocking"


@pytest.mark.asyncio
async def test_openai_compatible_provider_raises_on_invalid_json(monkeypatch):
    class FakeCompletions:
        async def create(self, **kwargs):
            message = SimpleNamespace(content="not valid json at all")
            choice = SimpleNamespace(message=message)
            usage = SimpleNamespace(prompt_tokens=1, completion_tokens=1)
            return SimpleNamespace(choices=[choice], usage=usage)

    class FakeChat:
        def __init__(self) -> None:
            self.completions = FakeCompletions()

    class FakeAsyncOpenAI:
        def __init__(self, *args, **kwargs) -> None:
            self.chat = FakeChat()

    monkeypatch.setattr(
        "app.assessment.providers.openai_compatible.AsyncOpenAI", FakeAsyncOpenAI
    )

    provider = OpenAICompatibleProvider()
    with pytest.raises(Exception):
        await provider.generate_assessment([_fact()], [], None)


@pytest.mark.asyncio
async def test_ollama_provider_parses_structured_output(monkeypatch):
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "message": {"content": VALID_RESULT_JSON},
                "prompt_eval_count": 55,
                "eval_count": 15,
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args) -> None:
            return None

        async def post(self, url, json=None):
            assert "/api/chat" in url
            assert json["format"] == "json"
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    provider = OllamaProvider()
    generation = await provider.generate_assessment([_fact()], [], None)

    assert generation.provider == "ollama"
    assert generation.result.risk_level == "blocking"
    assert generation.input_tokens == 55
    assert generation.output_tokens == 15
    assert generation.estimated_cost_usd == 0.0


@pytest.mark.asyncio
async def test_ollama_provider_raises_on_http_error(monkeypatch):
    class FakeResponse:
        def raise_for_status(self) -> None:
            raise httpx.HTTPStatusError(
                "boom", request=httpx.Request("POST", "http://x"), response=None
            )

        def json(self) -> dict:
            return {}

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args) -> None:
            return None

        async def post(self, url, json=None):
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    provider = OllamaProvider()
    with pytest.raises(httpx.HTTPStatusError):
        await provider.generate_assessment([_fact()], [], None)
