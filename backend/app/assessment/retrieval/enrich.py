"""Enrich retrieved references with human-readable regulation/SOP/incident content."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.python.schemas import RetrievedReference


def _parse_ref(raw: dict | RetrievedReference) -> RetrievedReference:
    if isinstance(raw, RetrievedReference):
        return raw
    chunk = raw.get("chunk_id")
    return RetrievedReference(
        source=raw["source"],
        id=UUID(str(raw["id"])),
        retrieval_path=raw["retrieval_path"],
        score=raw.get("score"),
        chunk_id=UUID(str(chunk)) if chunk else None,
        title=raw.get("title"),
        snippet=raw.get("snippet"),
        code=raw.get("code"),
        triggered_by_fact=raw.get("triggered_by_fact"),
        source_url=raw.get("source_url"),
        occurred_at=raw.get("occurred_at"),
    )


async def enrich_references(
    session: AsyncSession,
    refs: list[RetrievedReference] | list[dict],
) -> list[RetrievedReference]:
    """Batch-join regulations / sops / incidents onto retrieval stubs."""
    if not refs:
        return []

    parsed = [_parse_ref(r) for r in refs]
    by_source: dict[str, list[UUID]] = {
        "regulations": [],
        "sops": [],
        "historical_incidents": [],
    }
    for r in parsed:
        by_source.setdefault(r.source, []).append(r.id)

    reg_map: dict[str, tuple[str, str, str, str | None, str | None]] = {}
    if by_source["regulations"]:
        result = await session.execute(
            text(
                """
                SELECT id, code, title, body_summary, clause, source_url
                FROM regulations
                WHERE id = ANY(CAST(:ids AS uuid[]))
                """
            ),
            {"ids": [str(i) for i in by_source["regulations"]]},
        )
        for row in result.fetchall():
            m = row._mapping
            reg_map[str(m["id"])] = (
                m["code"],
                m["title"],
                m["body_summary"],
                m["clause"],
                m["source_url"],
            )

    sop_map: dict[str, tuple[str, str]] = {}
    if by_source["sops"]:
        result = await session.execute(
            text(
                """
                SELECT id, title, body_summary
                FROM sops
                WHERE id = ANY(CAST(:ids AS uuid[]))
                """
            ),
            {"ids": [str(i) for i in by_source["sops"]]},
        )
        for row in result.fetchall():
            m = row._mapping
            sop_map[str(m["id"])] = (m["title"], m["body_summary"])

    inc_map: dict[str, tuple[str, object | None]] = {}
    if by_source["historical_incidents"]:
        result = await session.execute(
            text(
                """
                SELECT id, description, reported_at
                FROM incidents
                WHERE id = ANY(CAST(:ids AS uuid[]))
                """
            ),
            {"ids": [str(i) for i in by_source["historical_incidents"]]},
        )
        for row in result.fetchall():
            m = row._mapping
            inc_map[str(m["id"])] = (m["description"], m["reported_at"])

    enriched: list[RetrievedReference] = []
    for r in parsed:
        key = str(r.id)
        title = r.title
        snippet = r.snippet
        code = r.code
        source_url = None
        occurred_at = r.occurred_at
        if r.source == "regulations" and key in reg_map:
            code, title, snippet, _clause, source_url = reg_map[key]
        elif r.source == "sops" and key in sop_map:
            title, snippet = sop_map[key]
            code = None
        elif r.source == "historical_incidents" and key in inc_map:
            snippet, occurred_at = inc_map[key]
            title = title or "Historical incident"
            code = None
        enriched.append(
            RetrievedReference(
                source=r.source,
                id=r.id,
                retrieval_path=r.retrieval_path,
                score=r.score,
                chunk_id=r.chunk_id,
                title=title,
                snippet=snippet,
                code=code,
                triggered_by_fact=r.triggered_by_fact,
                source_url=source_url,
                occurred_at=occurred_at,
            )
        )
    return enriched


def serialize_ref(r: RetrievedReference) -> dict:
    return {
        "source": r.source,
        "id": str(r.id),
        "retrieval_path": r.retrieval_path,
        "score": r.score,
        "chunk_id": str(r.chunk_id) if r.chunk_id else None,
        "title": r.title,
        "snippet": r.snippet,
        "code": r.code,
        "triggered_by_fact": r.triggered_by_fact,
        "source_url": r.source_url,
        "occurred_at": r.occurred_at.isoformat()
        if hasattr(r.occurred_at, "isoformat")
        else r.occurred_at,
    }
