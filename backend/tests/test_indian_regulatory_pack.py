"""Indian statutory pack (Factories Act 1948 / OISD) retrieval coverage.

The codes asserted here were previously invented — "Factory Act 1948 §41" (the
hazardous-process provisions are §41A-41H), "DGMS Circular 2017" (no number or
series, and DGMS regulates mines rather than a steel-plant coke oven), and
"OISD-STD-117" labelled as the work-permit standard (it is Fire Protection
Facilities; the work-permit standard is OISD-STD-105). They are now clause-level
citations carrying a source URL.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from app.assessment.retrieval.deterministic import DeterministicRetriever
from app.assessment.retrieval.enrich import enrich_references
from app.db.seed import seed_minimal
from app.db.seed_embeddings import (
    INDIAN_REGULATIONS,
    REGULATIONS,
    STATUTORY_CODES,
    seed_embeddings,
)
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool

# VSP hero compound facts
VSP_HERO_FACTS = ["elevated_gas", "incomplete_isolation", "zone_occupied"]

INDIAN_CODES = STATUTORY_CODES


def test_indian_regulations_seeded_in_corpus():
    codes = {row[1] for row in REGULATIONS}
    assert INDIAN_CODES.issubset(codes)


def test_statutory_pack_uses_real_citation_shapes():
    """Guards the specific fabrications this pack previously shipped."""
    codes = {row[1] for row in REGULATIONS}
    assert "Factory Act 1948 §41" not in codes, "bare §41 is not a real citation"
    assert not any(c.startswith("DGMS") for c in codes), "DGMS has no coke-oven jurisdiction"
    assert "OISD-STD-117" not in codes, "117 is Fire Protection, not Work Permit"
    assert "Factories Act 1948 s.37(1)" in codes
    assert "OISD-STD-105" in codes


def test_every_statutory_row_is_checkable():
    """A citation a reviewer cannot verify is not evidence."""
    for _rid, code, title, body, _cat, clause, url in INDIAN_REGULATIONS:
        assert code and title and body
        assert clause, f"{code} has no clause reference"
        assert url.startswith("https://"), f"{code} has no source URL"


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
    # elevated_gas -> s.37(1) (ignition sources), incomplete_isolation -> OISD-STD-105
    # (work permit system), zone_occupied -> s.36(2) (confined space entry).
    assert "Factories Act 1948 s.37(1)" in reg_codes
    assert "OISD-STD-105" in reg_codes
    assert "Factories Act 1948 s.36(2)" in reg_codes


@pytest.mark.asyncio
async def test_elevated_gas_prefers_statutory_provision_over_advisory_standard(session):
    """Rows carrying a clause + source URL outrank advisory standards."""
    retriever = DeterministicRetriever()
    refs = await retriever.retrieve(session, ["elevated_gas"])
    enriched = await enrich_references(session, refs)
    reg_refs = [r for r in enriched if r.source == "regulations"]
    assert reg_refs
    assert reg_refs[0].code == "Factories Act 1948 s.37(1)"
    assert reg_refs[0].source_url == "https://indiankanoon.org/doc/1217692/"
