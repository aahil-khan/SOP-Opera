"""Track per-agent LLM call outcomes for trace + AI Ops observability."""

from __future__ import annotations

from typing import Any, Literal

LlmOutcomeStatus = Literal["ok", "fallback"]


def make_outcome(
    agent: str,
    status: LlmOutcomeStatus,
    *,
    reason: str | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {"agent": agent, "status": status}
    if reason:
        out["reason"] = reason[:240]
    return out


def short_error(exc: BaseException) -> str:
    msg = str(exc).strip() or exc.__class__.__name__
    return msg[:240]


def normalize_provider(provider: str | None) -> str:
    name = (provider or "mock").lower()
    if name.startswith("langgraph:"):
        return name.split(":", 1)[1]
    return name


def is_live_llm_provider(provider: str | None) -> bool:
    return normalize_provider(provider) not in ("mock", "")


def summarize_llm_outcomes(
    outcomes: list[dict[str, Any]] | None,
    *,
    provider: str | None,
) -> dict[str, Any]:
    """Aggregate attempt/fallback counts for ai_ops_events."""
    if not is_live_llm_provider(provider):
        return {
            "llm_attempt_count": 0,
            "llm_fallback_count": 0,
            "degraded": False,
        }
    attempts = [
        o
        for o in outcomes or []
        if o.get("status") in ("ok", "fallback")
    ]
    fallbacks = [o for o in attempts if o.get("status") == "fallback"]
    return {
        "llm_attempt_count": len(attempts),
        "llm_fallback_count": len(fallbacks),
        "degraded": len(fallbacks) > 0,
    }
