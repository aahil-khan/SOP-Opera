from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio

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
    import asyncpg

    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn

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


@pytest.mark.asyncio
async def test_regulation_clause_reaches_the_reader(session):
    """
    W2 part A. `regulations.clause` is seeded and was selected by the enrichment
    query and then dropped on the floor (`enrich.py` unpacked it into `_clause`),
    so the clause-level provenance the corpus carries never reached the UI.

    At least one enriched regulation must now expose it — otherwise the seeded
    `clause` column is decoration.
    """
    from app.assessment.retrieval.enrich import enrich_references

    refs = await DeterministicRetriever().retrieve(session, ["elevated_gas"])
    enriched = await enrich_references(session, refs)

    regs = [r for r in enriched if r.source == "regulations"]
    assert regs, "elevated_gas retrieved no regulation to enrich"
    assert any(r.clause for r in regs), (
        "no enriched regulation carried a clause — it is being dropped again"
    )


@pytest.mark.asyncio
async def test_critical_gas_can_name_a_procedure(session):
    """
    `critical_gas` is the single-sensor incident line the pitch leads with, and
    it retrieved no SOP at all — so the deviation frame had nothing to name on
    the one fact that matters most. It aliases to the elevated-gas SOP, which is
    a real link (the same hazard, a fortiori at the higher reading) and is
    labelled `same_hazard` rather than passed off as a direct citation.
    """
    from app.assessment.reasoning import _sop_deviation
    from app.assessment.retrieval.enrich import enrich_references

    refs = await DeterministicRetriever().retrieve(session, ["critical_gas"])
    enriched = await enrich_references(session, refs)

    deviation = _sop_deviation("critical_gas", enriched)
    assert deviation is not None, "critical_gas still resolves no SOP"
    assert deviation.basis == "same_hazard"
    assert deviation.sop_title
    assert deviation.requirement
    assert deviation.clause is None


@pytest.mark.asyncio
async def test_sops_never_acquire_a_clause_number(session):
    """The seeded SOP corpus has none; anything else means one was invented."""
    from app.assessment.retrieval.enrich import enrich_references

    facts = [ft for ft in RETRIEVAL_RULES if "sops" in RETRIEVAL_RULES[ft]]
    enriched = await enrich_references(
        session, await DeterministicRetriever().retrieve(session, facts)
    )
    assert [r for r in enriched if r.source == "sops"], "no SOPs retrieved at all"
    assert all(r.clause is None for r in enriched if r.source == "sops")
