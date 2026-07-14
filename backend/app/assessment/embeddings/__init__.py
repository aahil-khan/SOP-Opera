"""Embedding providers — OpenAI-compatible primary, local/mock deterministic fallback."""

from __future__ import annotations

from app.core.config import get_settings


async def embed_text(text: str) -> list[float]:
    """Embed a single string using the configured EMBEDDING_PROVIDER."""
    settings = get_settings()
    provider = settings.embedding_provider.lower()
    if provider in ("openai_compatible", "openai"):
        from app.assessment.embeddings.openai_compatible import embed_openai

        return await embed_openai(text)
    if provider == "mock":
        from app.assessment.embeddings.mock import embed_mock

        return embed_mock(text, dim=settings.embedding_dim)
    # "local" or anything unrecognized → deterministic hash embedding
    from app.assessment.embeddings.local import embed_local

    return embed_local(text, dim=settings.embedding_dim)


async def embed_texts(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    provider = settings.embedding_provider.lower()
    if provider in ("openai_compatible", "openai") and texts:
        from app.assessment.embeddings.openai_compatible import embed_openai_batch

        return await embed_openai_batch(texts)
    if provider == "mock":
        from app.assessment.embeddings.mock import embed_mock

        return [embed_mock(t, dim=settings.embedding_dim) for t in texts]
    from app.assessment.embeddings.local import embed_local

    return [embed_local(t, dim=settings.embedding_dim) for t in texts]
