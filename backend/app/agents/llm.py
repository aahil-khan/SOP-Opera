"""LangChain chat model factory (OpenAI primary, Ollama fallback, mock = None)."""

from __future__ import annotations

import os
from typing import Any

from app.core.config import get_settings

# USD per 1M tokens — OpenAI-compatible paid models only; Ollama/mock = $0
_PRICE_PER_1M: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "default": (0.50, 1.50),
}


def configure_langsmith() -> None:
    """Enable LangSmith tracing when configured (idempotent)."""
    settings = get_settings()
    if not settings.langchain_tracing_v2:
        return
    if settings.langchain_api_key:
        os.environ["LANGCHAIN_API_KEY"] = settings.langchain_api_key
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_PROJECT"] = settings.langchain_project


def get_chat_model(provider_name: str | None = None) -> Any | None:
    """
    Return a LangChain chat model, or None for mock mode (deterministic agents).
    """
    configure_langsmith()
    settings = get_settings()
    key = (provider_name or settings.ai_provider or "mock").lower()
    timeout = settings.agent_llm_timeout_seconds
    if key in ("mock", ""):
        return None
    if key in ("openai_compatible", "openai"):
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key or "EMPTY",
            base_url=settings.openai_base_url,
            temperature=0.2,
            timeout=timeout,
            max_retries=1,
        )
    if key == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=settings.ollama_model,
            base_url=settings.ollama_base_url,
            temperature=0.2,
        )
    return None


def provider_label(provider_name: str | None = None) -> str:
    settings = get_settings()
    key = (provider_name or settings.ai_provider or "mock").lower()
    if key in ("openai_compatible", "openai"):
        return "openai_compatible"
    if key == "ollama":
        return "ollama"
    return "mock"


def model_label(provider_name: str | None = None) -> str:
    settings = get_settings()
    key = (provider_name or settings.ai_provider or "mock").lower()
    if key in ("openai_compatible", "openai"):
        return settings.openai_model
    if key == "ollama":
        return settings.ollama_model
    return "langgraph-mock-v1"


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def extract_usage(response: Any) -> tuple[int, int]:
    """
    Pull (input_tokens, output_tokens) from a LangChain AIMessage-like response.

    Handles OpenAI usage_metadata / response_metadata.token_usage and Ollama
    prompt_eval_count / eval_count when present. Missing → (0, 0).
    """
    if response is None:
        return 0, 0

    # LangChain standardized usage_metadata
    usage_meta = getattr(response, "usage_metadata", None)
    if isinstance(usage_meta, dict):
        tin = _as_int(
            usage_meta.get("input_tokens")
            or usage_meta.get("prompt_tokens")
            or usage_meta.get("input")
        )
        tout = _as_int(
            usage_meta.get("output_tokens")
            or usage_meta.get("completion_tokens")
            or usage_meta.get("output")
        )
        if tin is not None or tout is not None:
            return tin or 0, tout or 0

    meta = getattr(response, "response_metadata", None)
    if not isinstance(meta, dict):
        return 0, 0

    # OpenAI-style nested token_usage
    token_usage = meta.get("token_usage") or meta.get("usage")
    if isinstance(token_usage, dict):
        tin = _as_int(
            token_usage.get("prompt_tokens")
            or token_usage.get("input_tokens")
        )
        tout = _as_int(
            token_usage.get("completion_tokens")
            or token_usage.get("output_tokens")
        )
        if tin is not None or tout is not None:
            return tin or 0, tout or 0

    # Ollama raw fields sometimes surface on response_metadata
    tin = _as_int(meta.get("prompt_eval_count"))
    tout = _as_int(meta.get("eval_count"))
    if tin is not None or tout is not None:
        return tin or 0, tout or 0

    return 0, 0


def estimate_cost_usd(
    provider_name: str | None,
    model: str | None,
    tokens_in: int,
    tokens_out: int,
) -> float:
    """USD estimate for paid OpenAI-compatible models; Ollama/mock → 0."""
    key = (provider_name or "mock").lower()
    if key not in ("openai_compatible", "openai"):
        return 0.0
    pin, pout = _PRICE_PER_1M.get(model or "", _PRICE_PER_1M["default"])
    return (tokens_in * pin + tokens_out * pout) / 1_000_000.0


def usage_record(
    *,
    agent: str,
    response: Any,
    provider_name: str | None,
) -> dict[str, Any]:
    """Build a single llm_usage state entry from a model response."""
    tin, tout = extract_usage(response)
    model = model_label(provider_name)
    return {
        "agent": agent,
        "input_tokens": tin,
        "output_tokens": tout,
        "model": model,
        "provider": provider_label(provider_name),
        "estimated_cost_usd": estimate_cost_usd(provider_name, model, tin, tout),
    }


def sum_usage(entries: list[dict[str, Any]] | None) -> tuple[int, int, float]:
    """Sum (input_tokens, output_tokens, cost_usd) across usage records."""
    tin = 0
    tout = 0
    cost = 0.0
    for e in entries or []:
        tin += int(e.get("input_tokens") or 0)
        tout += int(e.get("output_tokens") or 0)
        cost += float(e.get("estimated_cost_usd") or 0.0)
    return tin, tout, cost
