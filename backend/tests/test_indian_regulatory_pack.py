"""Indian regulatory pack (OISD / DGMS / Factory Act) retrieval coverage."""

from __future__ import annotations

import pytest
import pytest_asyncio

from app.assessment.retrieval.deterministic import DeterministicRetriever
from app.assessment.retrieval.enrich import enrich_references
from app.db.seed import seed_minimal
from app.db.seed_embeddings import REGULATIONS, seed_embeddings
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool

# VSP hero compound facts
VSP_HERO_FACTS = ["elevated_gas", "incomplete_isolation", "zone_occupied"]

INDIAN_CODES = frozenset(
    {
        "OISD-GDN-116",
        "OISD-GDN-106",
        "OISD-STD-117",
        "Factory Act 1948 §41",
        "DGMS Circular 2017",
    }
)


def test_indian_regulations_seeded_in_corpus():
    codes = {row[1] for row in REGULATIONS}
    assert INDIAN_CODES.issubset(codes)


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
async def test_vsp_hero_facts_retrieve_indian_regulations_first(session):
    retriever = DeterministicRetriever()
    refs = await retriever.retrieve(session, VSP_HERO_FACTS)
    enriched = await enrich_references(session, refs)

    reg_codes = {
        r.code for r in enriched if r.source == "regulations" and r.code
    }
    assert "OISD-GDN-116" in reg_codes
    assert "OISD-GDN-106" in reg_codes or "DGMS Circular 2017" in reg_codes
    assert "Factory Act 1948 §41" in reg_codes


@pytest.mark.asyncio
async def test_elevated_gas_prefers_oisd_over_osha(session):
    retriever = DeterministicRetriever()
    refs = await retriever.retrieve(session, ["elevated_gas"])
    enriched = await enrich_references(session, refs)
    reg_refs = [r for r in enriched if r.source == "regulations"]
    assert reg_refs
    assert reg_refs[0].code == "OISD-GDN-116"
