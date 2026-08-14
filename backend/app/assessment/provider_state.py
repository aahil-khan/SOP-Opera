"""
Runtime default AI provider — set from the AI Ops page, applied at enqueue time.

The durable per-job copy stays on `assessments.provider_override` (written by
`enqueue_for_review`, drained by `pop_provider_override`); this module only
supplies the default used when a job is enqueued without an explicit override.
It is process-local state, not a `.env` change: it applies to assessments
enqueued by this API process from now on, and resets on restart. The AI Ops UI
labels it as such.
"""

from __future__ import annotations

VALID_PROVIDERS: tuple[str, ...] = ("mock", "ollama", "openai_compatible")

_runtime_provider: str | None = None


def get_runtime_provider() -> str | None:
    """The runtime default provider, or None when the env default applies."""
    return _runtime_provider


def set_runtime_provider(provider: str | None) -> None:
    """Set (or clear, with None) the runtime default provider."""
    global _runtime_provider
    if provider is not None and provider not in VALID_PROVIDERS:
        raise ValueError(
            f"Unknown provider {provider!r}; expected one of {VALID_PROVIDERS}"
        )
    _runtime_provider = provider
