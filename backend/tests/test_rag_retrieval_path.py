"""Proves the RAG path is actually taken end-to-end, not just present as dead code.

Uses the deterministic mock/local embedding provider so no network is needed: a
query built from the *exact* seeded chunk text hashes to the same vector as the
corpus embedding, so cosine similarity ~1.0 clears the quality gate and the
hybrid facade must choose mode='rag' over the deterministic fallback.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.assessment.retrieval import retrieve
from app.db.seed import seed_minimal
from app.db.seed_embeddings import seed_embeddings
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool


@pytest_asyncio.fixture
async def session():
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn
    import asyncpg
    import os

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    os.environ["EMBEDDING_PROVIDER"] = "mock"
    os.environ["RAG_ENABLED"] = "true"
    get_settings.cache_clear()

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    await seed_embeddings()

    async with SessionLocal() as s:
        yield s
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_rag_path_taken_when_query_matches_corpus(session):
    row = (
        await session.execute(
            text(
                "SELECT chunk_text FROM knowledge_chunks "
                "WHERE source_type = 'historical_incidents' "
                "AND embedding IS NOT NULL LIMIT 1"
            )
        )
    ).first()
    assert row is not None, "seed_embeddings did not produce any incident chunks"
    chunk_text = row._mapping["chunk_text"]

    result = await retrieve(session, query=chunk_text, fact_types=["elevated_gas"])

    assert result.mode == "rag", (
        f"expected RAG to win the quality gate on a near-exact match, "
        f"got mode={result.mode} quality={result.quality} score={result.best_score}"
    )
    assert result.quality == "good"
    assert result.best_score is not None and result.best_score >= 0.99
    assert result.refs
    rag_refs = [r for r in result.refs if r.retrieval_path == "rag"]
    assert rag_refs
    assert all(r.source == "historical_incidents" for r in rag_refs)
    assert all(r.chunk_id is not None for r in rag_refs)


@pytest.mark.asyncio
async def test_retrieve_skips_when_no_facts(session):
    result = await retrieve(session, query="anything", fact_types=[])
    assert result.mode == "skipped"
    assert result.refs == []


@pytest.mark.asyncio
async def test_rag_falls_back_to_deterministic_on_unrelated_query(session):
    # A query with no semantic relationship to the corpus should score low and
    # fall back — proving the quality gate genuinely discriminates rather than
    # always reporting "good".
    result = await retrieve(
        session,
        query="zzz qqq unrelated nonsense xk9",
        fact_types=["elevated_gas"],
    )
    assert result.mode == "deterministic"
    assert result.quality in ("weak", "empty")
    assert all(r.retrieval_path == "deterministic" for r in result.refs)


@pytest.mark.asyncio
async def test_rag_disabled_flag_skips_straight_to_deterministic(session, monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "rag_enabled", False)

    result = await retrieve(session, query="anything", fact_types=["zone_occupied"])
    assert result.mode in ("deterministic", "skipped")
    assert result.quality == "n_a"
