"""Integration tests for enrich_references + zone owner seeding."""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.assessment.retrieval.deterministic import DeterministicRetriever
from app.assessment.retrieval.enrich import enrich_references
from app.db.seed import ZONE_OWNERS, seed_minimal
from app.db.seed_embeddings import seed_embeddings
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool
from app.reviews.ownership import get_zone_owner, resolve_worker_names
from shared.python.schemas import RetrievedReference


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


@pytest.mark.asyncio
async def test_enrich_references_adds_titles(session):
    stubs = await DeterministicRetriever().retrieve(session, ["elevated_gas"])
    assert stubs
    assert all(r.triggered_by_fact == "elevated_gas" for r in stubs)
    enriched = await enrich_references(session, stubs)
    assert enriched
    for r in enriched:
        assert r.title, f"missing title for {r.id}"
        assert r.snippet, f"missing snippet for {r.id}"
        if r.source == "regulations":
            assert r.code


@pytest.mark.asyncio
async def test_enrich_references_sops_and_incidents(session):
    stubs = await DeterministicRetriever().retrieve(
        session, ["permit_conflict", "zone_occupied"]
    )
    enriched = await enrich_references(session, stubs)
    sources = {r.source for r in enriched}
    assert "sops" in sources or "regulations" in sources
    assert "historical_incidents" in sources
    assert all(r.title or r.snippet for r in enriched)


@pytest.mark.asyncio
async def test_zone_owners_seeded(session):
    row = await session.execute(text("SELECT COUNT(*) FROM zone_owners"))
    assert int(row.scalar_one()) >= len(ZONE_OWNERS)
    owner = await get_zone_owner(session, "coke-oven-battery")
    assert owner is not None
    assert owner.name == "Asha Rao"
    assert owner.role == "Area Supervisor"


@pytest.mark.asyncio
async def test_resolve_worker_names(session):
    wid = "55555555-5555-5555-5555-555555555551"
    names = await resolve_worker_names(session, [wid])
    assert names[wid] == "Asha Rao"


@pytest.mark.asyncio
async def test_enrich_empty_refs(session):
    assert await enrich_references(session, []) == []


@pytest.mark.asyncio
async def test_enrich_from_dicts(session):
    stubs = await DeterministicRetriever().retrieve(session, ["incomplete_isolation"])
    as_dicts = [
        {
            "source": r.source,
            "id": str(r.id),
            "retrieval_path": r.retrieval_path,
            "score": r.score,
            "chunk_id": None,
            "triggered_by_fact": r.triggered_by_fact,
        }
        for r in stubs
    ]
    enriched = await enrich_references(session, as_dicts)
    assert isinstance(enriched[0], RetrievedReference)
    assert enriched[0].title
