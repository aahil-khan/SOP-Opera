"""
Runtime default AI provider — resolved for AI Ops and applied at enqueue time.

The durable per-job copy stays on `assessments.provider_override` (written by
`enqueue_for_review`, drained by `pop_provider_override`); this module only
supplies the effective default used when a job is enqueued without an explicit
override. A runtime override is process-local state, not a `.env` change: it
applies to assessments enqueued by this API process from now on, and resets on
restart. Without an explicit runtime/env provider, automatic selection tries
Ollama, then OpenAI-compatible, then mock.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

from app.agents.llm_outcomes import normalize_provider
from app.core.config import get_settings

VALID_PROVIDERS: tuple[str, ...] = ("mock", "ollama", "openai_compatible")

_runtime_provider: str | None = None


@dataclass(frozen=True)
class ProviderCheck:
    provider: str
    model: str | None
    ok: bool
    status: str
    reason: str | None = None


def canonical_provider(provider: str | None) -> str:
    """
    Fold a stored provider label onto its `VALID_PROVIDERS` key.

    Runs are stamped with the path that produced them, not just the vendor:
    `agents/graph.py` writes `langgraph:<provider>`, and `openai` is a legacy
    spelling of `openai_compatible`. Both must collapse onto the same key or
    per-provider aggregates silently split into buckets nothing looks up.
    """
    key = normalize_provider(provider)
    if key in ("openai", "openai_compatible"):
        return "openai_compatible"
    return key


def _model_for(provider: str) -> str:
    settings = get_settings()
    if provider == "ollama":
        return settings.ollama_model
    if provider == "openai_compatible":
        return settings.openai_model
    return "langgraph-mock-v1"


def check_provider(provider: str) -> ProviderCheck:
    """Fast provider availability check used by AI Ops and auto-selection."""
    key = canonical_provider(provider)
    if key not in VALID_PROVIDERS:
        return ProviderCheck(
            provider=provider,
            model=None,
            ok=False,
            status="unknown",
            reason=(
                f"Unknown provider {provider!r}; expected one of "
                f"{VALID_PROVIDERS}"
            ),
        )
    settings = get_settings()
    if key == "mock":
        return ProviderCheck(
            provider=key,
            model=_model_for(key),
            ok=True,
            status="available",
            reason="Deterministic local fallback; no connection required.",
        )
    if key == "openai_compatible":
        if not (settings.openai_api_key or os.environ.get("OPENAI_API_KEY")):
            return ProviderCheck(
                provider=key,
                model=_model_for(key),
                ok=False,
                status="unconfigured",
                reason="OPENAI_API_KEY is not set.",
            )
        return ProviderCheck(
            provider=key,
            model=_model_for(key),
            ok=True,
            status="configured",
            reason=(
                "API key and model are configured; live assessment calls use "
                "the OpenAI-compatible LangChain client."
            ),
        )

    url = f"{settings.ollama_base_url.rstrip('/')}/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:  # noqa: S310
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return ProviderCheck(
            provider=key,
            model=_model_for(key),
            ok=False,
            status="unavailable",
            reason=f"Ollama not reachable at {settings.ollama_base_url} ({exc})",
        )
    names = {
        str(m.get("name", "")).split(":")[0]
        for m in body.get("models", [])
    }
    wanted = settings.ollama_model.split(":")[0]
    if wanted not in names:
        return ProviderCheck(
            provider=key,
            model=_model_for(key),
            ok=False,
            status="missing_model",
            reason=(
                f"Ollama model '{settings.ollama_model}' is not pulled "
                f"(have: {', '.join(sorted(names)) or 'none'})."
            ),
        )
    return ProviderCheck(
        provider=key,
        model=_model_for(key),
        ok=True,
        status="connected",
        reason=f"Ollama is reachable and has model '{settings.ollama_model}'.",
    )


def _explicit_env_provider() -> str | None:
    settings = get_settings()
    if "AI_PROVIDER" in os.environ:
        return canonical_provider(os.environ.get("AI_PROVIDER"))
    if "ai_provider" in getattr(settings, "model_fields_set", set()):
        return canonical_provider(settings.ai_provider)
    return None


def resolve_auto_provider() -> ProviderCheck:
    """Automatic default: Ollama -> configured hosted provider -> mock."""
    for provider in ("ollama", "openai_compatible", "mock"):
        check = check_provider(provider)
        if check.ok:
            return check
    return check_provider("mock")


def effective_provider_check() -> tuple[ProviderCheck, str, str | None]:
    """Return `(check, source, configured_default)` for new assessments."""
    runtime = get_runtime_provider()
    if runtime:
        return check_provider(runtime), "runtime_override", _explicit_env_provider()
    env_provider = _explicit_env_provider()
    if env_provider:
        return check_provider(env_provider), "env_default", env_provider
    return resolve_auto_provider(), "auto_default", None


def get_runtime_provider() -> str | None:
    """The explicit runtime provider, or None when resolution is automatic/env."""
    return _runtime_provider


def get_effective_runtime_provider() -> str:
    """Provider that should be stamped on new assessments without an override."""
    return effective_provider_check()[0].provider


def set_runtime_provider(provider: str | None) -> None:
    """Set (or clear, with None) the runtime default provider."""
    global _runtime_provider
    if (
        provider is not None
        and canonical_provider(provider) not in VALID_PROVIDERS
    ):
        raise ValueError(
            f"Unknown provider {provider!r}; expected one of {VALID_PROVIDERS}"
        )
    _runtime_provider = (
        canonical_provider(provider) if provider is not None else None
    )
