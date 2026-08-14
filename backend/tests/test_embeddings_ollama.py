"""Ollama embedding provider — padding maths and provider selection (no network)."""

from __future__ import annotations

import math

import pytest

from app.assessment.embeddings import (
    active_embedding_model,
    is_semantic_embedding_provider,
)
from app.assessment.embeddings.ollama import _pad
from app.core.config import get_settings


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def test_pad_extends_to_column_width():
    assert _pad([1.0, 2.0], 5) == [1.0, 2.0, 0.0, 0.0, 0.0]


def test_pad_truncates_when_longer():
    assert _pad([1.0, 2.0, 3.0], 2) == [1.0, 2.0]


def test_padding_does_not_change_cosine_similarity():
    """
    The 768→1536 pad must be lossless, or the quality gate reads a score the
    model never produced. Zeros contribute nothing to dot product or norm.
    """
    a = [0.3, -0.7, 0.2, 0.9]
    b = [0.1, -0.5, 0.4, 0.8]
    assert _cosine(_pad(a, 16), _pad(b, 16)) == pytest.approx(_cosine(a, b))


def test_provider_labels_are_honest_about_hash_providers(monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "mock")
    get_settings.cache_clear()
    assert "non-semantic" in active_embedding_model()
    assert is_semantic_embedding_provider() is False

    monkeypatch.setenv("EMBEDDING_PROVIDER", "local")
    get_settings.cache_clear()
    assert "non-semantic" in active_embedding_model()
    assert is_semantic_embedding_provider() is False

    monkeypatch.setenv("EMBEDDING_PROVIDER", "ollama")
    get_settings.cache_clear()
    assert "ollama" in active_embedding_model()
    assert is_semantic_embedding_provider() is True

    monkeypatch.setenv("EMBEDDING_PROVIDER", "openai_compatible")
    get_settings.cache_clear()
    assert active_embedding_model() == get_settings().embedding_model
    assert is_semantic_embedding_provider() is True

    monkeypatch.delenv("EMBEDDING_PROVIDER", raising=False)
    get_settings.cache_clear()
