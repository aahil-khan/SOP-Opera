from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.assessment.retrieval.deterministic import (
    RETRIEVAL_RULES,
    DeterministicRetriever,
    source_types_for_facts,
)
from app.db.seed import seed_minimal
from app.db.seed_embeddings import seed_embeddings
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool


@pytest_asyncio.fixture
async def session():
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn
    import asyncpg

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    await seed_embeddings()

    async with SessionLocal() as s:
        yield s
    await close_vector_pool()
    await engine.dispose()


def test_retrieval_rules_cover_hero_and_core_facts():
    hero = {"elevated_gas", "incomplete_isolation", "zone_occupied"}
    core = {
        "permit_conflict",
        "simultaneous_ops",
        "certification_expiring",
    }
    assert hero.issubset(RETRIEVAL_RULES.keys())
    assert core.issubset(RETRIEVAL_RULES.keys())
    assert "regulations" in RETRIEVAL_RULES["zone_occupied"]


def test_source_types_union():
    sources = source_types_for_facts(["elevated_gas", "permit_conflict"])
    assert "regulations" in sources
    assert "sops" in sources


@pytest.mark.asyncio
async def test_deterministic_each_fact_resolves(session):
    retriever = DeterministicRetriever()
    for fact_type, expected_sources in RETRIEVAL_RULES.items():
        refs = await retriever.retrieve(session, [fact_type])
        assert refs, f"expected refs for {fact_type}"
        got_sources = {r.source for r in refs}
        assert got_sources & set(expected_sources), (
            f"{fact_type}: got {got_sources}, expected subset of {expected_sources}"
        )
        assert all(r.retrieval_path == "deterministic" for r in refs)
        assert all(isinstance(r.id, UUID) for r in refs)
        assert all(r.triggered_by_fact == fact_type for r in refs)
