"""
Promote a closure report into the historical-incident corpus.

Reports are the immutable audit packet; incidents are what retrieval and the
IncidentEcho banner read. Linking them at freeze time means the next similar
compound condition can cite *this plant's own* prior decision — not only the
seeded near-misses.

One incident per review (uuid5 of the review id). A superseding close refreshes
the description and chunk in place rather than minting duplicates.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid5

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.assessment.retrieval.deterministic import RETRIEVAL_RULES
from app.reports.packet import ReportPacket

logger = logging.getLogger(__name__)

# Stable namespace so incident_id_for_review is deterministic across restarts.
_INCIDENT_NS = UUID("d4444444-4444-4444-4444-444444444401")

_PROMOTE_RISKS = frozenset({"elevated", "blocking"})
_PROMOTE_OUTCOMES = frozenset({"blocked", "approved_with_conditions"})


def incident_id_for_review(review_id: UUID) -> UUID:
    return uuid5(_INCIDENT_NS, str(review_id))


def should_promote(packet: ReportPacket) -> bool:
    """Skip nominal rubber-stamps — only precedents with compound signal or hold."""
    risk = (packet.assessment.risk_level if packet.assessment else None) or ""
    outcome = (packet.decision.outcome if packet.decision else None) or ""
    return risk in _PROMOTE_RISKS or outcome in _PROMOTE_OUTCOMES


def primary_category(packet: ReportPacket) -> str | None:
    """
    Pick the fact type that should drive deterministic incident lookup.

    Prefer a fact that already maps to historical_incidents in RETRIEVAL_RULES
    so the next assessment with the same signal finds this row.
    """
    fact_types: list[str] = [f.fact_type for f in packet.facts if f.fact_type]
    for rf in packet.reasoning_factors:
        if isinstance(rf, dict) and rf.get("fact_type"):
            fact_types.append(str(rf["fact_type"]))

    for ft in fact_types:
        if "historical_incidents" in RETRIEVAL_RULES.get(ft, []):
            return ft
    for ft in fact_types:
        if ft in RETRIEVAL_RULES:
            return ft
    return None


def build_description(packet: ReportPacket) -> str:
    """
    Short narrative for incidents.description / knowledge_chunks.chunk_text.

    Text before the first colon becomes the IncidentEcho title via enrich.
    """
    asset = packet.header.asset.name
    outcome = (
        packet.decision.outcome_label if packet.decision else None
    ) or "Closed"
    risk = (packet.assessment.risk_level if packet.assessment else None) or "unknown"
    summary = " ".join(
        ((packet.assessment.summary if packet.assessment else None) or "").split()
    )
    if len(summary) > 280:
        summary = summary[:277].rstrip() + "…"
    facts = ", ".join(f.label for f in packet.facts[:4]) or "no named facts"
    ref = packet.meta.report_ref
    body = f"{outcome} on {asset} ({risk})."
    if summary:
        body = f"{body} {summary}"
    return f"Plant closure {ref}: {body} Key signals: {facts}."


async def promote_closure_to_incident(
    session: AsyncSession,
    *,
    review: Any,
    packet: ReportPacket,
    report_id: UUID,
) -> UUID | None:
    """
    Upsert an incidents row for this closure inside the caller's transaction.

    Does not write knowledge_chunks — that needs the vector pool and should run
    only after the freeze commits, via index_promoted_incident.
    """
    if not should_promote(packet):
        logger.info(
            "skip incident promotion for review %s (risk=%s outcome=%s)",
            review.id,
            packet.assessment.risk_level if packet.assessment else None,
            packet.decision.outcome if packet.decision else None,
        )
        return None

    incident_id = incident_id_for_review(review.id)
    description = build_description(packet)
    category = primary_category(packet)
    asset_id = getattr(review, "asset_id", None)
    reported_at = datetime.now(timezone.utc)
    if packet.meta.frozen_at:
        try:
            reported_at = datetime.fromisoformat(packet.meta.frozen_at)
        except ValueError:
            pass

    await session.execute(
        text(
            """
            INSERT INTO incidents (
                id, asset_id, description, reported_at, linked_review_ids, applies_to_category
            )
            VALUES (
                CAST(:id AS uuid),
                CAST(:asset_id AS uuid),
                :desc,
                :reported_at,
                ARRAY[CAST(:review_id AS uuid)],
                :cat
            )
            ON CONFLICT (id) DO UPDATE SET
              description = EXCLUDED.description,
              reported_at = EXCLUDED.reported_at,
              applies_to_category = EXCLUDED.applies_to_category,
              asset_id = EXCLUDED.asset_id,
              linked_review_ids = EXCLUDED.linked_review_ids
            """
        ),
        {
            "id": str(incident_id),
            "asset_id": str(asset_id) if asset_id else None,
            "desc": description,
            "reported_at": reported_at,
            "review_id": str(review.id),
            "cat": category,
        },
    )

    logger.info(
        "promoted report %s → incident %s (review=%s cat=%s)",
        report_id,
        incident_id,
        review.id,
        category,
    )
    return incident_id


async def index_promoted_incident(incident_id: UUID) -> None:
    """Embed and upsert the knowledge_chunks row after the freeze has committed."""
    from app.assessment.embeddings import embed_texts
    from app.db import vector as vector_db
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT description, applies_to_category
                    FROM incidents
                    WHERE id = CAST(:id AS uuid)
                    """
                ),
                {"id": str(incident_id)},
            )
        ).first()
    if row is None:
        logger.warning("index_promoted_incident: incident %s missing", incident_id)
        return

    description = row._mapping["description"]
    category = row._mapping["applies_to_category"]
    embeddings = await embed_texts([description])
    emb = embeddings[0]

    await vector_db.execute(
        """
        DELETE FROM knowledge_chunks
        WHERE source_type = 'historical_incidents'
          AND source_id = $1::uuid
        """,
        incident_id,
    )
    await vector_db.execute(
        """
        INSERT INTO knowledge_chunks (
            source_type, source_id, chunk_text, embedding, applies_to_category, token_count
        )
        VALUES ('historical_incidents', $1::uuid, $2, $3, $4, $5)
        """,
        incident_id,
        description,
        emb,
        category,
        max(1, len(description.split())),
    )
    logger.info("indexed knowledge chunk for promoted incident %s", incident_id)


async def wipe_promoted_incidents(session: AsyncSession) -> int:
    """
    Remove runtime-promoted incidents (and their chunks), keeping the seed corpus.

    Called from demo reset so replay stays deterministic while still letting a
    single demo session accumulate live precedent.
    """
    from app.db.seed_embeddings import INCIDENTS

    seed_ids = [iid for iid, *_ in INCIDENTS]
    result = await session.execute(
        text(
            """
            DELETE FROM knowledge_chunks
            WHERE source_type = 'historical_incidents'
              AND NOT (source_id = ANY(CAST(:seed AS uuid[])))
            """
        ),
        {"seed": seed_ids},
    )
    chunks_deleted = result.rowcount or 0
    result = await session.execute(
        text(
            """
            DELETE FROM incidents
            WHERE NOT (id = ANY(CAST(:seed AS uuid[])))
            """
        ),
        {"seed": seed_ids},
    )
    incidents_deleted = result.rowcount or 0
    if incidents_deleted or chunks_deleted:
        logger.info(
            "wiped %d promoted incidents (%d chunks)",
            incidents_deleted,
            chunks_deleted,
        )
    return incidents_deleted
