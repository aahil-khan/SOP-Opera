"""
Shift-Handover Agent — did this hazard survive the last shift change?

The previous version of this node templated a sentence out of `AgentState` with
no I/O and wrote it to `shift_handover_note`, which nothing ever read. It ran
*after* the orchestrator, so its observation could not reach the verdict either.

It now reports something the assessment could not otherwise know: whether an
item on this asset was handed to an incoming operator who never acknowledged it.
That is the Piper Alpha failure mode stated as a fact, and it reaches the verdict
as `unacknowledged_handover` — a non-grounding CONTROL_FAILURE signal that can
escalate to elevated but never block on its own (see `risk/policy.py`).

The carried items are loaded by `assessment/pipeline.py`, which holds the DB
session, and arrive in `state["carried_handover_items"]`. Graph nodes stay pure.
"""

from __future__ import annotations

from typing import Any

from app.agents.events import make_step
from app.agents.state import AgentObservation, AgentState

_RISK_ORDER = {"blocking": 0, "elevated": 1, "nominal": 2}


def _fmt_age(hours: float | None) -> str:
    if hours is None:
        return "an unknown time"
    if hours < 1:
        return f"{int(round(hours * 60))} minutes"
    if hours < 48:
        return f"{hours:.1f} hours"
    return f"{hours / 24:.1f} days"


async def shift_handover_agent(state: AgentState) -> dict[str, Any]:
    review_id = state.get("review_id")
    assessment_id = state.get("assessment_id")
    asset_name = state.get("asset_name") or "this asset"
    carried = list(state.get("carried_handover_items") or [])

    started = make_step(
        "shift_handover",
        "started",
        "Shift Handover Agent checking carry-forward from the previous shift",
        review_id=review_id,
        assessment_id=assessment_id,
    )

    if not carried:
        note = (
            f"No unacknowledged handover items are outstanding on {asset_name}. "
            "Nothing was carried across a shift boundary unread."
        )
        obs: AgentObservation = {
            "agent": "shift_handover",
            "observation": note,
            "local_risk": "nominal",
            "fact_types": [],
            "detail": {"carried_count": 0},
        }
    else:
        worst = min(
            carried,
            key=lambda i: _RISK_ORDER.get(str(i.get("risk_level")), 3),
        )
        age = _fmt_age(worst.get("hours_outstanding"))
        incoming = worst.get("incoming_actor_name") or "the incoming operator"
        others = (
            f" {len(carried) - 1} further item"
            f"{'s' if len(carried) > 2 else ''} on this asset also went "
            "unacknowledged."
            if len(carried) > 1
            else ""
        )
        note = (
            f'"{worst.get("title")}" was handed to {incoming} {age} ago and has '
            f"never been acknowledged.{others} The incoming shift may not know "
            f"about this condition on {asset_name}."
        )
        obs = {
            "agent": "shift_handover",
            "observation": note,
            "local_risk": "elevated",
            "fact_types": ["unacknowledged_handover"],
            "detail": {
                "carried_count": len(carried),
                "worst_item_id": str(worst.get("id") or ""),
                "worst_item_title": worst.get("title"),
                "worst_item_risk": worst.get("risk_level"),
                "handover_id": str(worst.get("handover_id") or ""),
                "incoming_actor_name": incoming,
                "hours_outstanding": worst.get("hours_outstanding"),
            },
        }

    completed = (
        "Handover carry-forward clear"
        if not carried
        else f"{len(carried)} unacknowledged handover item"
        f"{'s' if len(carried) != 1 else ''} on this asset"
    )
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
                detail=obs["detail"],
                finding="risk" if carried else "clearance",
            ).model_dump(),
            make_step(
                "shift_handover",
                "completed",
                completed,
                review_id=review_id,
                assessment_id=assessment_id,
            ).model_dump(),
        ],
    }
