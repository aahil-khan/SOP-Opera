"""Generative Shift-Handover Agent — safety brief from recent plant events."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.events import broadcast_agent_step, make_step
from app.agents.llm import get_chat_model, model_label, provider_label
from app.agents.state import AgentObservation, AgentState
from app.core.config import get_settings


def _mock_brief(
    *,
    asset_summaries: list[str],
    open_reviews: list[str],
    active_facts: list[str],
    window_hours: int,
) -> str:
    facts = ", ".join(active_facts) or "none"
    reviews = "; ".join(open_reviews) or "none"
    guidance = (
        "Treat any elevated gas + active hot work as a compound stop-work "
        "until isolation is verified. Do not clear permits in zones with "
        "unresolved assessments."
        if active_facts
        else "Nominal conditions. Continue routine monitoring."
    )
    signal_lines = "\n".join(f"- {a}" for a in asset_summaries[:12]) or "- (none)"
    return (
        f"## Shift Safety Brief (last {window_hours}h)\n\n"
        f"**Active derived facts across plant:** {facts}\n\n"
        f"**Open / pending reviews:** {reviews}\n\n"
        f"**Recent signals:**\n{signal_lines}\n\n"
        f"**Handover guidance:** {guidance}\n"
    )


async def _llm_brief(prompt: str, provider_name: str | None) -> str | None:
    model = get_chat_model(provider_name)
    if model is None:
        return None
    try:
        result = await model.ainvoke(prompt)
        content = getattr(result, "content", None)
        if isinstance(content, str) and content.strip():
            return content.strip()
    except Exception:  # noqa: BLE001
        return None
    return None


async def collect_shift_context(
    session: AsyncSession, *, window_hours: int = 12
) -> dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    ctx = await session.execute(
        text(
            """
            SELECT c.asset_id, a.name, c.category, c.payload, c.valid_from
            FROM context_entries c
            JOIN assets a ON a.id = c.asset_id
            WHERE c.valid_from >= :since
            ORDER BY c.valid_from DESC
            LIMIT 40
            """
        ),
        {"since": since},
    )
    asset_summaries: list[str] = []
    for row in ctx.fetchall():
        m = row._mapping
        payload = m["payload"] if isinstance(m["payload"], dict) else {}
        bits = ", ".join(f"{k}={v}" for k, v in list(payload.items())[:4])
        asset_summaries.append(
            f"{m['name']} [{m['category']}] {bits} @ {m['valid_from']}"
        )

    facts = await session.execute(
        text(
            """
            SELECT DISTINCT ON (asset_id, fact_type)
                a.name, d.fact_type, d.value, d.computed_at
            FROM derived_facts d
            JOIN assets a ON a.id = d.asset_id
            WHERE d.computed_at >= :since
            ORDER BY asset_id, fact_type, computed_at DESC
            """
        ),
        {"since": since},
    )
    active_facts: list[str] = []
    for row in facts.fetchall():
        m = row._mapping
        value = m["value"]
        if isinstance(value, dict):
            value = value.get("value", value)
        if value is True or value == "true":
            active_facts.append(f"{m['name']}:{m['fact_type']}")

    reviews = await session.execute(
        text(
            """
            SELECT r.id, r.asset_id, a.name, r.state, am.risk_level
            FROM reviews r
            JOIN assets a ON a.id = r.asset_id
            LEFT JOIN LATERAL (
                SELECT risk_level
                FROM assessments
                WHERE review_id = r.id AND status = 'complete'
                ORDER BY version DESC
                LIMIT 1
            ) am ON true
            WHERE r.state NOT IN ('closed')
            ORDER BY r.created_at DESC
            LIMIT 20
            """
        )
    )
    open_reviews: list[dict[str, Any]] = []
    risk_rank = {"blocking": 0, "elevated": 1, "nominal": 2}
    attention_asset_id: str | None = None
    attention_rank = 99
    for row in reviews.fetchall():
        m = row._mapping
        risk = m["risk_level"] or "n/a"
        item = {
            "review_id": str(m["id"]),
            "asset_id": str(m["asset_id"]),
            "asset_name": m["name"],
            "state": m["state"],
            "risk_level": risk,
            "label": (
                f"{m['name']} state={m['state']} risk={risk} ({m['id']})"
            ),
        }
        open_reviews.append(item)
        rank = risk_rank.get(str(risk), 3)
        if rank < attention_rank:
            attention_rank = rank
            attention_asset_id = str(m["asset_id"])

    if attention_asset_id is None and open_reviews:
        attention_asset_id = open_reviews[0]["asset_id"]

    return {
        "window_hours": window_hours,
        "asset_summaries": asset_summaries,
        "active_facts": active_facts,
        "open_reviews": open_reviews,
        "attention_asset_id": attention_asset_id,
    }


async def generate_shift_handover(
    session: AsyncSession,
    *,
    window_hours: int = 12,
    provider_name: str | None = None,
) -> dict[str, Any]:
    """Standalone shift-handover generation (HTTP endpoint)."""
    settings = get_settings()
    pname = provider_name or settings.ai_provider
    ctx = await collect_shift_context(session, window_hours=window_hours)
    open_review_labels = [
        r["label"] if isinstance(r, dict) else str(r) for r in ctx["open_reviews"]
    ]

    await broadcast_agent_step(
        make_step(
            "shift_handover",
            "started",
            f"Shift Handover Agent summarizing last {window_hours}h",
        )
    )

    prompt = (
        "You are an industrial shift-handover safety brief writer. "
        "Produce a concise markdown brief for the incoming supervisor. "
        "Do not invent facts.\n\n"
        f"Window: last {window_hours} hours\n"
        f"Active facts: {ctx['active_facts']}\n"
        f"Open reviews: {open_review_labels}\n"
        f"Recent signals:\n"
        + "\n".join(f"- {s}" for s in ctx["asset_summaries"][:20])
    )
    brief = await _llm_brief(prompt, pname)
    if brief is None:
        brief = _mock_brief(
            asset_summaries=ctx["asset_summaries"],
            open_reviews=open_review_labels,
            active_facts=ctx["active_facts"],
            window_hours=window_hours,
        )

    await broadcast_agent_step(
        make_step(
            "shift_handover",
            "completed",
            "Shift Handover brief ready",
            detail={"provider": provider_label(pname), "model": model_label(pname)},
        )
    )

    return {
        "brief": brief,
        "window_hours": window_hours,
        "provider": f"langgraph:{provider_label(pname)}",
        "model": model_label(pname),
        "active_facts": ctx["active_facts"],
        "open_reviews": ctx["open_reviews"],
        "attention_asset_id": ctx.get("attention_asset_id"),
        "signal_count": len(ctx["asset_summaries"]),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


async def shift_handover_agent(state: AgentState) -> dict[str, Any]:
    """
    In-graph note for the incoming supervisor using facts already in AgentState.
    Full plant brief is available via POST /agents/shift-handover.
    """
    review_id = state.get("review_id")
    assessment_id = state.get("assessment_id")
    facts = list(state.get("fact_types") or [])
    started = make_step(
        "shift_handover",
        "started",
        "Shift Handover Agent drafting note for incoming supervisor",
        review_id=review_id,
        assessment_id=assessment_id,
    )
    if facts:
        note = (
            f"Incoming shift: active facts on {state.get('asset_name')} — "
            f"{', '.join(facts)}. Do not authorize hot work until assessment is decided."
        )
        risk = "elevated"
    else:
        note = (
            f"Incoming shift: {state.get('asset_name')} nominal in this review window."
        )
        risk = "nominal"

    obs: AgentObservation = {
        "agent": "shift_handover",
        "observation": note,
        "local_risk": risk,
        "fact_types": [],
        "detail": {"handover_note": note},
    }
    return {
        "observations": [obs],
        "agent_trace": [
            started.model_dump(),
            make_step(
                "shift_handover",
                "observation",
                note,
                review_id=review_id,
                assessment_id=assessment_id,
            ).model_dump(),
            make_step(
                "shift_handover",
                "completed",
                "Shift Handover note attached",
                review_id=review_id,
                assessment_id=assessment_id,
            ).model_dump(),
        ],
        "shift_handover_note": note,
    }
