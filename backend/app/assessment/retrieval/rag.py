"""RAG retriever — embed query, cosine top-k over knowledge_chunks via pgvector."""

from __future__ import annotations

import logging
from uuid import UUID

from shared.python.schemas import RetrievedReference

from app.assessment.embeddings import embed_text
from app.core.config import get_settings
from app.db import vector as vector_db

logger = logging.getLogger(__name__)

# Map knowledge_chunks.source_type ↔ RetrievedReference.source
_CHUNK_TO_REF_SOURCE = {
    "regulations": "regulations",
    "historical_incidents": "historical_incidents",
    "sops": "sops",
}


class RagRetriever:
    """Embed the Orchestrator-built query; cosine top-k over knowledge_chunks."""

    async def retrieve(
        self, query: str, source_types: list[str], top_k: int
    ) -> list[RetrievedReference]:
        if not query.strip() or not source_types:
            return []

        settings = get_settings()
        embedding = await embed_text(query)

        # pgvector cosine distance: embedding <=> query ; similarity = 1 - distance
        rows = await vector_db.fetch(
            """
            SELECT id, source_type, source_id, embedding <=> $1 AS distance
            FROM knowledge_chunks
            WHERE source_type = ANY($2::text[])
              AND embedding IS NOT NULL
            ORDER BY embedding <=> $1
            LIMIT $3
            """,
            embedding,
            source_types,
            top_k,
        )

        refs: list[RetrievedReference] = []
        for row in rows:
            source = _CHUNK_TO_REF_SOURCE.get(row["source_type"])
            if source is None:
                continue
            distance = float(row["distance"])
            score = max(0.0, min(1.0, 1.0 - distance))
            refs.append(
                RetrievedReference(
                    source=source,  # type: ignore[arg-type]
                    id=UUID(str(row["source_id"])),
                    retrieval_path="rag",
                    score=score,
                    chunk_id=UUID(str(row["id"])),
                )
            )
        return refs
