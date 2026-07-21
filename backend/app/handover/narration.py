"""
Prose over an already-fixed carry-forward list.

The model never chooses what carries — `composer.py` does that. This module only
turns the chosen list into a paragraph, which is the same division the assessment
pipeline keeps between the LLM's `summary` and the policy's `risk_level`.

The returned `narration_mode` says which path produced the text. The previous
implementation reported `provider: "langgraph:<label>"` even when its LLM call
had failed and a hardcoded template had run instead, so a supervisor could not
tell a written brief from a canned one. Reporting the fallback is the point.
"""

from __future__ import annotations

import logging
from typing import Any

from app.agents.llm import get_chat_model, model_label, provider_label

logger = logging.getLogger(__name__)

_MAX_PROMPT_ITEMS = 25


def _describe(items: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    required = [i for i in items if i.get("requires_ack")]
    awareness = [i for i in items if not i.get("requires_ack")]
    return (
        [f"{i['title']} ({i['risk_level']})" for i in required],
        [f"{i['title']} ({i['risk_level']})" for i in awareness],
    )


def deterministic_brief(items: list[dict[str, Any]], *, window_hours: int) -> str:
    """Template narration — the default, since AI_PROVIDER is `mock` by default."""
    required, awareness = _describe(items)
    if not items:
        return (
            f"Nothing carried forward from the last {window_hours} hours. No open "
            "reviews, active facts, outstanding tasks, or live approval conditions."
        )

    parts: list[str] = [
        f"{len(items)} item{'s' if len(items) != 1 else ''} carried forward from "
        f"the last {window_hours} hours."
    ]
    if required:
        parts.append(
            f"{len(required)} need acknowledgement before the incoming operator "
            f"takes custody: {'; '.join(required[:6])}"
            + ("; and others." if len(required) > 6 else ".")
        )
    else:
        parts.append("Nothing on the list requires acknowledgement.")
    if awareness:
        parts.append(
            f"{len(awareness)} further item{'s are' if len(awareness) != 1 else ' is'} "
            "listed for awareness only."
        )
    return " ".join(parts)


async def narrate(
    items: list[dict[str, Any]],
    *,
    window_hours: int,
    provider_name: str | None,
) -> tuple[str, str, str, str]:
    """
    Returns `(brief, narration_mode, provider, model)`.

    `narration_mode` is `llm` only when a model actually returned usable prose.
    """
    provider = provider_label(provider_name)
    model = model_label(provider_name)
    fallback = deterministic_brief(items, window_hours=window_hours)

    chat = get_chat_model(provider_name)
    if chat is None:
        return fallback, "deterministic", provider, model

    required, awareness = _describe(items)
    prompt = (
        "You are writing the spoken part of an industrial shift handover for the "
        "incoming panel operator. Write one short paragraph, no headings, no "
        "bullet points, no more than 90 words. Describe only the items listed "
        "below — do not invent hazards, numbers, or regulations. Lead with what "
        "must be acknowledged.\n\n"
        f"Window: last {window_hours} hours\n"
        f"Requires acknowledgement: {required[:_MAX_PROMPT_ITEMS] or 'none'}\n"
        f"For awareness: {awareness[:_MAX_PROMPT_ITEMS] or 'none'}"
    )
    try:
        result = await chat.ainvoke(prompt)
        content = getattr(result, "content", None)
        if isinstance(content, str) and content.strip():
            return content.strip(), "llm", provider, model
        logger.warning("handover narration returned empty content; using template")
    except Exception:  # noqa: BLE001 - any provider failure degrades to template
        logger.warning("handover narration failed; using template", exc_info=True)
    return fallback, "deterministic", provider, model
