"""
Ollama embeddings — real semantic vectors with no hosted API and no key.

Why this exists: `mock` and `local` are both SHA-256 expansions. They are stable
and dependency-free, but two texts about the same hazard land no closer together
than two unrelated ones, so cosine scores are noise and the RAG quality gate can
never honestly pass. That makes "we do semantic retrieval" a claim we could not
demonstrate offline.

`nomic-embed-text` through a local Ollama gives genuine semantic similarity with
no credential and no network egress — the same switch that makes the quality gate
capable of passing also keeps the whole stack runnable on a plant network.

**Dimension note:** `nomic-embed-text` returns 768 dimensions and
`knowledge_chunks.embedding` is `vector(1536)`, so vectors are zero-padded to
`EMBEDDING_DIM`. Padding both sides with zeros leaves dot products and norms
unchanged, so cosine similarity is *exactly* the 768-dim value — no schema change
(`db/schema.sql` is a choke point) and no distortion of the score the gate reads.
"""

from __future__ import annotations

import httpx

from app.core.config import get_settings


def _pad(vector: list[float], dim: int) -> list[float]:
    """Zero-pad (or truncate) to the column width. Zeros are cosine-neutral."""
    if len(vector) >= dim:
        return [float(v) for v in vector[:dim]]
    return [float(v) for v in vector] + [0.0] * (dim - len(vector))


async def embed_ollama(text: str) -> list[float]:
    settings = get_settings()
    url = f"{settings.ollama_base_url.rstrip('/')}/api/embeddings"
    async with httpx.AsyncClient(timeout=settings.agent_llm_timeout_seconds) as client:
        resp = await client.post(
            url,
            json={"model": settings.ollama_embedding_model, "prompt": text},
        )
        resp.raise_for_status()
        data = resp.json()
    vector = data.get("embedding") or []
    if not vector:
        raise RuntimeError(
            f"Ollama returned no embedding for model "
            f"{settings.ollama_embedding_model!r}"
        )
    return _pad(vector, settings.embedding_dim)


async def embed_ollama_batch(texts: list[str]) -> list[list[float]]:
    """
    Sequential batch — Ollama's embeddings endpoint takes one prompt per call.

    Called from `seed_embeddings()` at boot over a corpus of a few hundred
    chunks; keeping it sequential avoids stampeding a local model server that is
    usually also serving the chat path.
    """
    return [await embed_ollama(t) for t in texts]
