"""
Assemble the pattern-discovery view, and record human verdicts on it (W13).

Patterns are recomputed from closed history on every read rather than stored.
A stored pattern would go stale the moment another review closed, and the panel
would be quoting a number no longer supported by the evidence behind it — which
is the one thing a surface like this cannot afford.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import record_audit
from app.db.session import get_seeded_mode
from app.patterns import repository as repo
from app.patterns.miner import ALPHA, MIN_RATIO, MIN_SUPPORT, mine
from app.patterns.schemas import MinedScopeOut, PatternOut, PatternsOut

DEFAULT_WINDOW_MONTHS = 12
SHIFT_START_HOUR = 6
"""Plant day starts at 06:00 — see scripts/seed_history.py SHIFT_START_HOUR."""


class PatternError(Exception):
    """A verdict was asked for on something the miner does not currently report."""


def _iso(value: object) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


async def build_view(
    session: AsyncSession, months: int = DEFAULT_WINDOW_MONTHS
) -> PatternsOut:
    events = await repo.load_events(session, months)
    span = await repo.corpus_span(session, months)
    verdicts = await repo.list_verdicts(session)

    candidates = mine(events, start_hour=SHIFT_START_HOUR)

    patterns: list[PatternOut] = []
    for c in candidates:
        v = verdicts.get(c.key)
        patterns.append(
            PatternOut(
                key=c.key,
                family=c.family,
                claim=c.claim,
                hits=c.hits,
                trials=c.trials,
                rate=c.rate,
                base_rate=c.base_rate,
                ratio=c.ratio,
                why_no_rule=c.why_no_rule,
                covered_by=c.covered_by,
                # Capped: the panel links to evidence, it does not ship the
                # whole corpus to the browser on every poll.
                review_ids=list(c.review_ids[:25]),
                state=(v or {}).get("state", "candidate"),
                decided_by=(v or {}).get("actor"),
                decided_at=_iso((v or {}).get("decided_at")),
                note=(v or {}).get("note"),
            )
        )

    return PatternsOut(
        scope=MinedScopeOut(
            window_months=months,
            review_count=span["review_count"] or 0,
            asset_count=span["asset_count"] or 0,
            first_review_at=_iso(span["first_at"]),
            last_review_at=_iso(span["last_at"]),
            min_support=MIN_SUPPORT,
            min_ratio=MIN_RATIO,
            alpha=ALPHA,
        ),
        patterns=patterns,
        corpus_is_seeded=get_seeded_mode(),
    )


async def record_verdict(
    session: AsyncSession,
    *,
    pattern_key: str,
    state: str,
    actor: str,
    note: str | None,
    months: int = DEFAULT_WINDOW_MONTHS,
) -> PatternOut:
    """
    Ratify or dismiss a pattern.

    The claim and its statistics are re-derived and stored alongside the verdict,
    so the record says what was actually being judged. A ratification that only
    stored a key would, after the corpus moved, read as approval of whatever
    that key means today.

    Note what this does *not* do: nothing here touches `risk/policy.py`. A
    ratified pattern is a recorded human judgement, not a new gate on the plant.
    """
    if state not in ("ratified", "dismissed"):
        raise PatternError(f"Unknown verdict: {state}")

    view = await build_view(session, months)
    match = next((p for p in view.patterns if p.key == pattern_key), None)
    if match is None:
        raise PatternError(
            "That pattern is not in the current mined set — the corpus may have "
            "moved since the page was loaded."
        )

    row_id, decided_at = await repo.upsert_verdict(
        session,
        pattern_key=pattern_key,
        state=state,
        claim=match.claim,
        ratio=match.ratio,
        hits=match.hits,
        trials=match.trials,
        actor=actor,
        note=note,
    )

    await record_audit(
        session,
        entity_type="pattern",
        entity_id=UUID(str(row_id)),
        event_type=f"pattern.{state}",
        actor=actor,
        payload={
            "pattern_key": pattern_key,
            "family": match.family,
            "claim": match.claim,
            "hits": match.hits,
            "trials": match.trials,
            "ratio": round(match.ratio, 3),
            "note": note,
        },
    )
    await session.commit()

    return match.model_copy(
        update={
            "state": state,
            "decided_by": actor,
            "decided_at": _iso(decided_at),
            "note": note,
        }
    )
