"""Mock embeddings — identical to local hash embeddings (offline/CI alias)."""

from app.assessment.embeddings.local import embed_local

__all__ = ["embed_local", "embed_mock"]


def embed_mock(text: str, *, dim: int = 1536) -> list[float]:
    return embed_local(text, dim=dim)
