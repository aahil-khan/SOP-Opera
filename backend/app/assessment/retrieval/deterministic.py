"""Deterministic SQL fallback retrieval keyed by Derived Fact types (TDS §5.4.3)."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from shared.python.schemas import RetrievedReference
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

SourceType = Literal["regulations", "historical_incidents", "sops"]

# Statutory provisions surface first: a citation carrying a clause reference and a
# source URL can be checked against the primary text, so it outranks an advisory
# standard. This replaces a `code LIKE 'OISD%'` prefix test, which ranked by how a
# string happened to start and silently stopped matching when codes were corrected.
_INDIAN_REG_ORDER = """
    CASE WHEN clause IS NOT NULL THEN 0 ELSE 1 END,
    code
"""

_INDIAN_SOP_ORDER = """
    CASE
        WHEN title LIKE 'SOP-OISD%' OR title LIKE 'SOP-Factory Act%' THEN 0
        ELSE 1
    END,
    title
"""

RETRIEVAL_RULES: dict[str, list[SourceType]] = {
    "elevated_gas": ["regulations", "historical_incidents"],
    # "sops" included so the SOP-deviation frame (W2) can name a procedure for a
    # threshold breach. The alias below routes it to the elevated-gas SOP — the
    # corpus has no SOP for the critical level specifically, and inventing one is
    # exactly what is not being done here.
    "critical_gas": ["regulations", "historical_incidents", "sops"],
    "permit_conflict": ["sops", "regulations"],
    "zone_occupied": ["historical_incidents", "regulations", "sops"],
    "incomplete_isolation": ["sops", "regulations"],
    "simultaneous_ops": ["sops", "historical_incidents"],
    "certification_expiring": ["regulations", "sops"],
    "over_temperature": ["regulations", "sops"],
    "critical_temperature": ["regulations", "sops"],
    "equipment_vibration_anomaly": ["sops", "historical_incidents"],
    "effluent_quality_breach": ["regulations"],
    "tank_level_critical": ["sops", "regulations"],
    "ppe_noncompliance": ["sops", "regulations"],
    "lifting_operation_conflict": ["sops", "historical_incidents"],
    "weather_hold": ["sops", "regulations"],
    "spatial_cooccurrence": ["historical_incidents", "regulations"],
}


# Corpus rows carry exactly one `applies_to_category`, so a fact type with no
# row of its own retrieves nothing at all. Three had none, and `critical_gas` is
# the worst of them: it is the single-sensor incident line, so a critical-gas
# assessment was being produced with zero citations.
#
# These are not new clauses — inventing statute to close a gap is the one thing
# the citation validator exists to prevent. They say that a fact is governed by
# the corpus already seeded for the *same hazard*: a threshold breach is the
# elevated condition of the same substance or energy, and the provisions that
# govern it apply a fortiori at the higher reading.
_CATEGORY_ALIASES: dict[str, str] = {
    "critical_gas": "elevated_gas",
    "critical_temperature": "over_temperature",
    # Proximity to a hazardous zone rests on the same basis as occupancy of one.
    # The weakest of the three — replace it if a dedicated clause is seeded.
    "spatial_cooccurrence": "zone_occupied",
}


def _lookup_category(fact_type: str) -> str:
    """The corpus category a fact type is cited against."""
    return _CATEGORY_ALIASES.get(fact_type, fact_type)


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
                    f"""
                    SELECT id FROM regulations
                    WHERE applies_to_category = :cat
                       OR applies_to_category IS NULL
                    ORDER BY {_INDIAN_REG_ORDER}
                    LIMIT 5
                    """
                ),
                {"cat": _lookup_category(fact_type)},
            )
        elif source == "sops":
            result = await session.execute(
                text(
                    f"""
                    SELECT id FROM sops
                    WHERE applies_to_category = :cat
                       OR applies_to_category IS NULL
                    ORDER BY {_INDIAN_SOP_ORDER}
                    LIMIT 5
                    """
                ),
                {"cat": _lookup_category(fact_type)},
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
                {"cat": _lookup_category(fact_type)},
            )
        return [row._mapping["id"] for row in result.fetchall()]
