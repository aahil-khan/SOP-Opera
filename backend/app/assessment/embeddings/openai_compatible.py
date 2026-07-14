"""OpenAI-compatible embeddings endpoint."""

from __future__ import annotations

from openai import AsyncOpenAI

from app.core.config import get_settings


def _client() -> AsyncOpenAI:
    settings = get_settings()
    return AsyncOpenAI(
        api_key=settings.openai_api_key or "no-key",
        base_url=settings.openai_base_url,
    )


async def embed_openai(text: str) -> list[float]:
    settings = get_settings()
    client = _client()
    resp = await client.embeddings.create(
        model=settings.embedding_model,
        input=text,
    )
    return list(resp.data[0].embedding)


async def embed_openai_batch(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    settings = get_settings()
    client = _client()
    resp = await client.embeddings.create(
        model=settings.embedding_model,
        input=texts,
    )
    # OpenAI may return out of order — sort by index
    ordered = sorted(resp.data, key=lambda d: d.index)
    return [list(d.embedding) for d in ordered]
