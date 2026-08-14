"""Embedding providers — OpenAI-compatible primary, local/mock deterministic fallback."""

from __future__ import annotations

from app.core.config import get_settings


def active_embedding_model() -> str:
    """
    The model actually producing vectors, for display and traces.

    Reported honestly per provider: a hash provider is named as one rather than
    borrowing `EMBEDDING_MODEL`, which describes the hosted model only.
    """
    settings = get_settings()
    provider = settings.embedding_provider.lower()
    if provider in ("openai_compatible", "openai"):
        return settings.embedding_model
    if provider == "ollama":
        return f"{settings.ollama_embedding_model} (ollama, local)"
    if provider == "local":
        return "sha256-hash (local, non-semantic)"
    return "mock-hash (non-semantic)"


def is_semantic_embedding_provider() -> bool:
    """
    True when vectors carry meaning.

    `mock` and `local` are SHA-256 expansions: similarity between them is noise,
    so the RAG quality gate cannot honestly pass and the deterministic SQL path
    always wins. Surfaces use this to say which is running.
    """
    return get_settings().embedding_provider.lower() in (
        "openai_compatible",
        "openai",
        "ollama",
    )


async def embed_text(text: str) -> list[float]:
    """Embed a single string using the configured EMBEDDING_PROVIDER."""
    settings = get_settings()
    provider = settings.embedding_provider.lower()
    if provider in ("openai_compatible", "openai"):
        from app.assessment.embeddings.openai_compatible import embed_openai

        return await embed_openai(text)
    if provider == "ollama":
        from app.assessment.embeddings.ollama import embed_ollama

        return await embed_ollama(text)
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
    if provider == "ollama" and texts:
        from app.assessment.embeddings.ollama import embed_ollama_batch

        return await embed_ollama_batch(texts)
    if provider == "mock":
        from app.assessment.embeddings.mock import embed_mock

        return [embed_mock(t, dim=settings.embedding_dim) for t in texts]
    from app.assessment.embeddings.local import embed_local

    return [embed_local(t, dim=settings.embedding_dim) for t in texts]
