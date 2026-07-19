"""Hybrid retrieval facade: RAG primary → quality gate → deterministic fallback."""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from shared.python.schemas import RetrievedReference

from app.assessment.retrieval.deterministic import (
    DeterministicRetriever,
    source_types_for_facts,
)
from app.assessment.retrieval.rag import RagRetriever
from app.core.config import get_settings

logger = logging.getLogger(__name__)

RetrievalQuality = Literal["good", "weak", "empty"]
RetrievalMode = Literal["rag", "deterministic", "skipped"]

# Vector RAG only for incidents (orchestrator does not consume regs/SOPs today).
RAG_VECTOR_SOURCE_TYPES: list[str] = ["historical_incidents"]


def assess_retrieval_quality(
    refs: list[RetrievedReference],
    *,
    score_threshold: float,
    min_chunks: int = 1,
) -> RetrievalQuality:
    """Grade RAG results before the Orchestrator commits them to the prompt."""
    if not refs:
        return "empty"
    strong = [r for r in refs if (r.score is not None and r.score >= score_threshold)]
    if len(strong) >= min_chunks:
        return "good"
    return "weak"


class HybridRetrievalResult:
    def __init__(
        self,
        refs: list[RetrievedReference],
        mode: RetrievalMode,
        quality: RetrievalQuality | Literal["n_a"],
        best_score: float | None,
        embedding_model: str | None,
        source_types: list[str],
    ) -> None:
        self.refs = refs
        self.mode = mode
        self.quality = quality
        self.best_score = best_score
        self.embedding_model = embedding_model
        self.source_types = source_types


def _merge_rag_incidents_with_det(
    rag_refs: list[RetrievedReference],
    det_refs: list[RetrievedReference],
) -> list[RetrievedReference]:
    """Prefer vector incident hits when present; keep deterministic regs/SOPs (+ other)."""
    seen: set[tuple[str, str]] = set()
    out: list[RetrievedReference] = []
    for r in rag_refs:
        key = (r.source, str(r.id))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    for r in det_refs:
        if r.source == "historical_incidents" and rag_refs:
            # Drop det incidents when RAG supplied stronger hits
            continue
        key = (r.source, str(r.id))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


async def retrieve(
    session: AsyncSession,
    *,
    query: str,
    fact_types: list[str],
) -> HybridRetrievalResult:
    """
    Skip when no facts. Otherwise deterministic for all mapped sources;
    vector RAG only for historical_incidents when RAG is enabled.
    """
    settings = get_settings()
    source_types = source_types_for_facts(fact_types)
    embedding_model = (
        settings.embedding_model if settings.embedding_provider != "mock" else "mock-hash"
    )

    if not fact_types:
        return HybridRetrievalResult(
            refs=[],
            mode="skipped",
            quality="n_a",
            best_score=None,
            embedding_model=None,
            source_types=[],
        )

    det = DeterministicRetriever()
    det_refs = await det.retrieve(session, fact_types)

    if not settings.rag_enabled:
        return HybridRetrievalResult(
            refs=det_refs,
            mode="deterministic" if det_refs else "skipped",
            quality="n_a",
            best_score=None,
            embedding_model=None,
            source_types=list(source_types),
        )

    if "historical_incidents" not in source_types:
        return HybridRetrievalResult(
            refs=det_refs,
            mode="deterministic" if det_refs else "skipped",
            quality="n_a",
            best_score=None,
            embedding_model=embedding_model,
            source_types=list(source_types),
        )

    rag_refs: list[RetrievedReference] = []
    quality: RetrievalQuality = "empty"
    try:
        rag = RagRetriever()
        timeout_s = max(0.1, settings.rag_timeout_ms / 1000.0)
        rag_refs = await asyncio.wait_for(
            rag.retrieve(query, list(RAG_VECTOR_SOURCE_TYPES), settings.rag_top_k),
            timeout=timeout_s,
        )
        quality = assess_retrieval_quality(
            rag_refs,
            score_threshold=settings.rag_score_threshold,
            min_chunks=1,
        )
    except Exception as exc:  # noqa: BLE001 — any RAG failure → fallback
        logger.warning("RAG retrieval failed/timed out, using deterministic: %s", exc)
        rag_refs = []
        quality = "empty"

    best = max((r.score or 0.0 for r in rag_refs), default=None)
    if quality == "good":
        merged = _merge_rag_incidents_with_det(rag_refs, det_refs)
        return HybridRetrievalResult(
            refs=merged,
            mode="rag",
            quality=quality,
            best_score=best,
            embedding_model=embedding_model,
            source_types=list(source_types),
        )

    return HybridRetrievalResult(
        refs=det_refs,
        mode="deterministic" if det_refs else "skipped",
        quality=quality,
        best_score=best,
        embedding_model=embedding_model,
        source_types=list(source_types),
    )


def build_retrieval_query(
    *,
    fact_types: list[str],
    triggered_by: str,
    asset_name: str,
    asset_zone: str,
) -> str:
    facts = ", ".join(sorted(fact_types)) or "none"
    return (
        f"Operational review for asset {asset_name} in zone {asset_zone}. "
        f"Triggered by: {triggered_by}. "
        f"Active derived facts: {facts}. "
        f"Relevant regulations, SOPs, and historical incidents."
    )
