"""Deterministic SQL fallback retrieval keyed by Derived Fact types (TDS §5.4.3)."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.python.schemas import RetrievedReference

SourceType = Literal["regulations", "historical_incidents", "sops"]

RETRIEVAL_RULES: dict[str, list[SourceType]] = {
    "elevated_gas": ["regulations"],
    "permit_conflict": ["sops", "regulations"],
    "zone_occupied": ["historical_incidents"],
    "incomplete_isolation": ["sops", "regulations"],
    "simultaneous_ops": ["sops", "historical_incidents"],
    "certification_expiring": ["regulations", "sops"],
    "over_temperature": ["regulations", "sops"],
    "equipment_vibration_anomaly": ["sops", "historical_incidents"],
    "effluent_quality_breach": ["regulations"],
    "tank_level_critical": ["sops", "regulations"],
    "ppe_noncompliance": ["sops", "regulations"],
    "lifting_operation_conflict": ["sops", "historical_incidents"],
    "weather_hold": ["sops", "regulations"],
}


def source_types_for_facts(fact_types: list[str]) -> list[SourceType]:
    seen: set[str] = set()
    out: list[SourceType] = []
    for ft in fact_types:
        for src in RETRIEVAL_RULES.get(ft, []):
            if src not in seen:
                seen.add(src)
                out.append(src)
    return out


class DeterministicRetriever:
    """SQL lookup via RETRIEVAL_RULES keyed by active Derived Fact types."""

    async def retrieve(
        self, session: AsyncSession, fact_types: list[str]
    ) -> list[RetrievedReference]:
        refs: list[RetrievedReference] = []
        seen: set[tuple[str, str]] = set()

        for fact_type in fact_types:
            sources = RETRIEVAL_RULES.get(fact_type, [])
            for source in sources:
                rows = await self._lookup(session, source, fact_type)
                for row_id in rows:
                    key = (source, str(row_id))
                    if key in seen:
                        continue
                    seen.add(key)
                    refs.append(
                        RetrievedReference(
                            source=source,
                            id=row_id,
                            retrieval_path="deterministic",
                            score=None,
                            chunk_id=None,
                            triggered_by_fact=fact_type,
                        )
                    )
        return refs

    async def _lookup(
        self, session: AsyncSession, source: SourceType, fact_type: str
    ) -> list[UUID]:
        if source == "regulations":
            result = await session.execute(
                text(
                    """
                    SELECT id FROM regulations
                    WHERE applies_to_category = :cat
                       OR applies_to_category IS NULL
                    ORDER BY code
                    LIMIT 5
                    """
                ),
                {"cat": fact_type},
            )
        elif source == "sops":
            result = await session.execute(
                text(
                    """
                    SELECT id FROM sops
                    WHERE applies_to_category = :cat
                       OR applies_to_category IS NULL
                    ORDER BY title
                    LIMIT 5
                    """
                ),
                {"cat": fact_type},
            )
        else:  # historical_incidents
            result = await session.execute(
                text(
                    """
                    SELECT id FROM incidents
                    WHERE applies_to_category = :cat
                       OR applies_to_category IS NULL
                    ORDER BY reported_at DESC
                    LIMIT 5
                    """
                ),
                {"cat": fact_type},
            )
        return [row._mapping["id"] for row in result.fetchall()]
