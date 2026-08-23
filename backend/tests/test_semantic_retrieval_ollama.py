"""
Semantic retrieval end-to-end on real vectors (W5), via local Ollama embeddings.

The existing RAG path test (`test_rag_retrieval_path.py`) proves the plumbing by
feeding a query that is *literally the chunk text*, which any hash provider
matches at ~1.0. That proves wiring, not semantics.

This file is the harder claim: a paraphrase — an operational description that
shares almost no words with the corpus — must still retrieve the right incident
and clear the gate, while an unrelated plant query must be rejected by the gate
and fall through to deterministic SQL with citations intact.

Skips (loudly, with a reason) when Ollama or the embedding model is absent. The
rest of the suite must never depend on a local model server being installed.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import pytest
import pytest_asyncio
from sqlalchemy import text

from app.assessment.retrieval import retrieve
from app.assessment.retrieval.deterministic import source_types_for_facts
from app.core.config import get_settings
from app.db.seed import seed_minimal
from app.db.seed_embeddings import seed_embeddings
from app.db.session import SessionLocal, apply_schema, engine
from app.db.vector import close_vector_pool

EMBED_MODEL = "nomic-embed-text"


def _ollama_has_model(model: str) -> bool:
    settings = get_settings()
    url = f"{settings.ollama_base_url.rstrip('/')}/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:  # noqa: S310
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return False
    return model in {m.get("name", "").split(":")[0] for m in body.get("models", [])}


@pytest_asyncio.fixture
async def session():
    import asyncpg

    from app.db.session import _asyncpg_dsn

    if not _ollama_has_model(EMBED_MODEL):
        pytest.skip(
            f"Ollama embedding model '{EMBED_MODEL}' unavailable — "
            f"run `ollama pull {EMBED_MODEL}` to exercise real semantic retrieval"
        )

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    prior = os.environ.get("EMBEDDING_PROVIDER")
    prior_gate = os.environ.get("RAG_SCORE_THRESHOLD")
    os.environ["EMBEDDING_PROVIDER"] = "ollama"
    os.environ["RAG_ENABLED"] = "true"
    # The gate is calibrated per embedding model, not guessed. Measured with
    # `python -m app.eval.rag_calibration` on nomic-embed-text against the seeded
    # incident corpus: relevant hits score 0.66–0.77, the best hit for a query
    # about canteen menus scores 0.50. 0.62 sits in that gap. The 0.72 default is
    # the mock-era number and rejects real paraphrases — see .env.example.
    os.environ["RAG_SCORE_THRESHOLD"] = "0.62"
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
    if prior is None:
        os.environ.pop("EMBEDDING_PROVIDER", None)
    else:
        os.environ["EMBEDDING_PROVIDER"] = prior
    if prior_gate is None:
        os.environ.pop("RAG_SCORE_THRESHOLD", None)
    else:
        os.environ["RAG_SCORE_THRESHOLD"] = prior_gate
    get_settings.cache_clear()


PARAPHRASE_QUERY = (
    "Combustible vapour is building up around a coking battery while a crew has "
    "an open permit for cutting and welding, and the equipment was never locked "
    "out. People are still standing in the area."
)

UNRELATED_QUERY = (
    "Quarterly canteen menu rotation and the visitor car park resurfacing "
    "schedule for the administrative block."
)


@pytest.mark.asyncio
async def test_paraphrase_retrieves_the_right_incident_and_clears_the_gate(session):
    """Real semantics: no shared vocabulary with the corpus, still the right hit."""
    result = await retrieve(
        session, query=PARAPHRASE_QUERY, fact_types=["elevated_gas"]
    )

    assert result.best_score is not None
    assert result.mode == "rag", (
        f"paraphrase should clear the gate on real embeddings — "
        f"mode={result.mode} quality={result.quality} score={result.best_score}"
    )
    assert result.quality == "good"
    assert result.best_score >= get_settings().rag_score_threshold
    rag_refs = [r for r in result.refs if r.retrieval_path == "rag"]
    assert rag_refs, "expected at least one vector-backed reference"
    # W5: vector search spans rag_vector_source_types (regulations too, for
    # elevated_gas), so top_k can include a regulation alongside the incident —
    # assert the paraphrase matched an incident via RAG, not that every rag ref
    # is one.
    incident_refs = [r for r in rag_refs if r.source == "historical_incidents"]
    assert incident_refs, (
        f"expected the paraphrase to match an incident via RAG, "
        f"got sources {[r.source for r in rag_refs]}"
    )
    assert "ollama" in (result.embedding_model or "")

    # The hit is the right one, not merely a hit: read the chunk it matched.
    # (References are enriched with titles later in the pipeline, so at this
    # layer the chunk id is the only handle on what was actually retrieved.)
    row = (
        await session.execute(
            text("SELECT chunk_text FROM knowledge_chunks WHERE id = :cid"),
            {"cid": str(incident_refs[0].chunk_id)},
        )
    ).first()
    assert row is not None
    matched = row._mapping["chunk_text"].lower()
    assert any(term in matched for term in ("gas", "coke oven", "hazardous zone")), (
        f"top vector hit is off-topic for a gas/hot-work paraphrase: {matched[:120]}"
    )


@pytest.mark.asyncio
async def test_vector_search_extends_past_incidents_only(session, monkeypatch):
    """
    W5: vector search is no longer incidents-only when embeddings are real.

    `rag_vector_source_types` is a config list. With hash embeddings, widening it
    was pointless — nothing ever cleared the gate. With real vectors, regulations
    and SOPs are searchable too, and the deterministic path still runs underneath
    so citation coverage cannot regress.
    """
    settings = get_settings()
    monkeypatch.setattr(
        settings,
        "rag_vector_source_types",
        ["historical_incidents", "regulations", "sops"],
    )

    result = await retrieve(
        session,
        query=PARAPHRASE_QUERY,
        fact_types=["elevated_gas", "incomplete_isolation", "zone_occupied"],
    )

    assert result.mode == "rag"
    rag_sources = {r.source for r in result.refs if r.retrieval_path == "rag"}
    assert rag_sources - {"historical_incidents"}, (
        f"expected vector hits beyond incidents, got {rag_sources}"
    )
    # The citation floor holds: every source type this fact combination needs
    # is present in the merged output, whether the winning ref came from
    # vector search or the deterministic path underneath it. RAG covering a
    # source type fully (and superseding its deterministic ref) is the
    # intended win, not a regression — see _merge_rag_with_det.
    needed = set(
        source_types_for_facts(["elevated_gas", "incomplete_isolation", "zone_occupied"])
    )
    present = {r.source for r in result.refs}
    assert needed <= present, f"expected coverage for {needed}, got {present}"


@pytest.mark.asyncio
async def test_weak_vector_hit_is_rejected_and_falls_through_with_citations(session):
    """
    The demo beat: we do not blindly trust vector search.

    An off-topic query still returns *something* from a vector index — that is
    what nearest-neighbour search does. The gate is what refuses it, and the
    deterministic path is what keeps citations on the assessment anyway.
    """
    result = await retrieve(
        session, query=UNRELATED_QUERY, fact_types=["elevated_gas"]
    )

    assert result.mode == "deterministic"
    assert result.quality in ("weak", "empty")
    if result.best_score is not None:
        assert result.best_score < get_settings().rag_score_threshold
    assert result.refs, "fallback must still produce citations"
    assert all(r.retrieval_path == "deterministic" for r in result.refs)
