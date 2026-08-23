"""
SQL for pattern discovery (W13).

The corpus is read from **frozen closure reports**, not from live `derived_facts`.
`derived_facts` keeps only the latest row per fact type per asset, so it cannot
say what was true at the time of a review a year ago; the report packet is the
decision-time snapshot and is hash-stamped, which is exactly what a claim about
history needs to rest on.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.patterns.miner import Event


def _seeded_clause(alias: str = "rv") -> str:
    """Honour the process-wide seeded-mode filter, as history/repository.py does.

    Without it, toggling Seeded mode off would move the numbers on /history and
    /reports but leave the mined patterns unchanged — which reads as one of them
    lying about the same corpus.
    """
    from app.db.session import get_seeded_mode

    return "" if get_seeded_mode() else f" AND {alias}.is_seeded = FALSE"


async def load_events(session: AsyncSession, months: int) -> list[Event]:
    """Closures in the window, as the miner's Event shape.

    One row per **closure**, not per review. A review that is reopened and
    re-closed is a fresh operational event on that asset each time — new
    context, a new assessment, a new human decision — and collapsing those onto
    the review would throw away most of the corpus and, worse, most of its time
    axis: `reviews.created_at` marks first-opened, so every later closure would
    be dated to the first one and a year of history would read as a handful of
    instants.

    Dated by `generated_at`, the moment the packet was frozen, which is when
    that closure actually happened.
    """
    result = await session.execute(
        text(
            """
            SELECT
                r.id AS report_id,
                r.review_id,
                rv.asset_id,
                a.name AS asset_name,
                r.generated_at AS at,
                r.content AS content,
                (
                    SELECT ass.risk_level
                    FROM assessments ass
                    WHERE ass.review_id = r.review_id
                      AND ass.status = 'complete'
                    ORDER BY ass.created_at DESC
                    LIMIT 1
                ) AS risk_level
            FROM reports r
            JOIN reviews rv ON rv.id = r.review_id
            JOIN assets a ON a.id = rv.asset_id
            WHERE r.generated_at >= now() - make_interval(months => :months)
            """
            + _seeded_clause()
            + """
            ORDER BY r.generated_at
            """
        ),
        {"months": months},
    )

    events: list[Event] = []
    for row in result.fetchall():
        m = row._mapping
        content = m["content"] or {}
        facts = _fact_types(content)
        events.append(
            Event(
                review_id=str(m["review_id"]),
                asset_id=str(m["asset_id"]),
                asset_name=m["asset_name"],
                at=m["at"],
                facts=facts,
                verdict=m["risk_level"] or "nominal",
            )
        )
    return events


def _fact_types(content: dict) -> tuple[str, ...]:
    """
    Fact types the packet froze, preferring `reasoning_factors`.

    Both keys carry the same set in practice; `reasoning_factors` is what the
    assessment actually reasoned over, so it is the honest answer to "what did
    the system know", and `facts` is the fallback for older packet versions.
    """
    for key in ("reasoning_factors", "facts"):
        rows = content.get(key)
        if isinstance(rows, list) and rows:
            found = {
                r.get("fact_type")
                for r in rows
                if isinstance(r, dict) and r.get("fact_type")
            }
            if found:
                return tuple(sorted(found))
    return ()


async def corpus_span(session: AsyncSession, months: int) -> dict:
    result = await session.execute(
        text(
            """
            SELECT count(*) AS review_count,
                   min(r.generated_at) AS first_at,
                   max(r.generated_at) AS last_at,
                   count(DISTINCT rv.asset_id) AS asset_count
            FROM reports r
            JOIN reviews rv ON rv.id = r.review_id
            WHERE r.generated_at >= now() - make_interval(months => :months)
            """
            + _seeded_clause()
        ),
        {"months": months},
    )
    return dict(result.first()._mapping)


async def list_verdicts(session: AsyncSession) -> dict[str, dict]:
    """Every recorded human verdict, keyed by pattern."""
    result = await session.execute(
        text(
            """
            SELECT pattern_key, id, state, actor, note, decided_at
            FROM pattern_verdicts
            """
        )
    )
    return {r._mapping["pattern_key"]: dict(r._mapping) for r in result.fetchall()}


async def upsert_verdict(
    session: AsyncSession,
    *,
    pattern_key: str,
    state: str,
    claim: str,
    ratio: float,
    hits: int,
    trials: int,
    actor: str,
    note: str | None,
) -> tuple[UUID, datetime]:
    """
    Record a human verdict on a pattern.

    Upsert rather than insert: a supervisor changing their mind is a normal act,
    and the audit chain is where the history of that lives — not a pile of rows
    here that the panel would then have to disambiguate.
    """
    result = await session.execute(
        text(
            """
            INSERT INTO pattern_verdicts
                (pattern_key, state, claim, ratio, hits, trials, actor, note)
            VALUES
                (:pattern_key, :state, :claim, :ratio, :hits, :trials, :actor, :note)
            ON CONFLICT (pattern_key) DO UPDATE SET
                state      = EXCLUDED.state,
                claim      = EXCLUDED.claim,
                ratio      = EXCLUDED.ratio,
                hits       = EXCLUDED.hits,
                trials     = EXCLUDED.trials,
                actor      = EXCLUDED.actor,
                note       = EXCLUDED.note,
                decided_at = now()
            RETURNING id, decided_at
            """
        ),
        {
            "pattern_key": pattern_key,
            "state": state,
            "claim": claim,
            "ratio": ratio,
            "hits": hits,
            "trials": trials,
            "actor": actor,
            "note": note,
        },
    )
    row = result.first()
    return row._mapping["id"], row._mapping["decided_at"]
