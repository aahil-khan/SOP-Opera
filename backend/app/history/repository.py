"""Aggregate SQL over the operating history.

Read-only. Every query counts the *current* assessment only (`status='complete'`)
so a review that was reassessed is not double-counted, and joins through
`reviews.created_at` rather than `assessments.created_at` so a late reassessment
does not move a review into the wrong month.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Shared predicate. Kept as one string so the three queries cannot drift apart
# on which assessments they consider.
_CURRENT = "a.status = 'complete'"


def _seeded_clause() -> str:
    """Honour the process-wide seeded-mode filter, the same way
    reports/repository.py::select_reports does. Without this, toggling Seeded
    mode off would move the numbers on /reports but leave /history unchanged,
    which reads as one of the two lying."""
    from app.db.session import get_seeded_mode

    return "" if get_seeded_mode() else " AND r.is_seeded = FALSE"


async def fact_distribution(session: AsyncSession, months: int) -> list[dict[str, Any]]:
    """How often each derived fact appears. Nominal reviews contribute nothing
    here by construction — they have no facts — so this is a distribution over
    the reviews where something actually fired."""
    rows = await session.execute(
        text(
            f"""
            SELECT df.fact_type AS fact_type, count(*) AS count
            FROM assessments a
            JOIN reviews r ON r.id = a.review_id
            CROSS JOIN LATERAL unnest(a.derived_fact_ids) AS fid
            JOIN derived_facts df ON df.id = fid
            WHERE {_CURRENT}
              AND r.created_at >= now() - make_interval(months => :months)
              {_seeded_clause()}
            GROUP BY 1
            ORDER BY count DESC, fact_type
            """
        ),
        {"months": months},
    )
    return [dict(r) for r in rows.mappings()]


async def verdicts_by_month(session: AsyncSession, months: int) -> list[dict[str, Any]]:
    rows = await session.execute(
        text(
            f"""
            SELECT to_char(date_trunc('month', r.created_at), 'YYYY-MM') AS month,
                   count(*) FILTER (WHERE a.risk_level = 'nominal')  AS nominal,
                   count(*) FILTER (WHERE a.risk_level = 'elevated') AS elevated,
                   count(*) FILTER (WHERE a.risk_level = 'blocking') AS blocking
            FROM assessments a
            JOIN reviews r ON r.id = a.review_id
            WHERE {_CURRENT}
              AND r.created_at >= now() - make_interval(months => :months)
              {_seeded_clause()}
            GROUP BY 1
            ORDER BY 1
            """
        ),
        {"months": months},
    )
    return [dict(r) for r in rows.mappings()]


async def top_authorities(
    session: AsyncSession, months: int, limit: int
) -> list[dict[str, Any]]:
    """Most-cited regulations and SOPs, from the references actually retrieved.

    Counts `retrieved_references`, not the regulations table, so this reflects
    what assessments really cited rather than what exists to be cited. `reviews`
    is reported alongside `citations` because one assessment can cite the same
    clause twice via two facts, and the review count is the honest denominator.
    """
    rows = await session.execute(
        text(
            f"""
            SELECT ref->>'source' AS source,
                   coalesce(nullif(ref->>'code', ''), ref->>'title') AS label,
                   count(*) AS citations,
                   count(DISTINCT a.review_id) AS reviews
            FROM assessments a
            JOIN reviews r ON r.id = a.review_id
            JOIN assessment_metadata am ON am.assessment_id = a.id
            CROSS JOIN LATERAL jsonb_array_elements(am.retrieved_references) AS ref
            WHERE {_CURRENT}
              AND r.created_at >= now() - make_interval(months => :months)
              {_seeded_clause()}
              AND ref->>'source' IN ('regulations', 'sops')
              AND coalesce(nullif(ref->>'code', ''), ref->>'title') IS NOT NULL
            GROUP BY 1, 2
            ORDER BY citations DESC, label
            LIMIT :limit
            """
        ),
        {"months": months, "limit": limit},
    )
    return [dict(r) for r in rows.mappings()]


async def corpus_span(session: AsyncSession, months: int) -> dict[str, Any]:
    rows = await session.execute(
        text(
            f"""
            SELECT count(*) AS review_count,
                   min(r.created_at) AS first_review_at,
                   max(r.created_at) AS last_review_at
            FROM assessments a
            JOIN reviews r ON r.id = a.review_id
            WHERE {_CURRENT}
              AND r.created_at >= now() - make_interval(months => :months)
              {_seeded_clause()}
            """
        ),
        {"months": months},
    )
    return dict(rows.mappings().one())
