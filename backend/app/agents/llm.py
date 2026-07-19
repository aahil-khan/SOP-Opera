"""LangChain chat model factory (OpenAI primary, Ollama fallback, mock = None)."""

from __future__ import annotations

import os
from typing import Any

from app.core.config import get_settings


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
