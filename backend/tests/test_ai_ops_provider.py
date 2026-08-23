"""W9a — runtime provider selection endpoints + per-assessment events listing."""

from __future__ import annotations

import json

from uuid import UUID, uuid4
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from tests.test_ai_ops_summary import _seed_mixed_assessments
from tests.test_assessment_pipeline import _cleanup_vessel

VESSEL_A = UUID("11111111-1111-1111-1111-111111111111")


def _configured_ollama_model() -> str:
    """
    Whatever `.env` actually asks for.

    `check_provider()` compares the tag list against `settings.ollama_model`, and
    the DB-backed tests below patch only `urlopen` — so they run against the real
    settings. Hard-coding a model name here makes those tests pass or fail on the
    contents of the developer's `.env` rather than on the code under test.
    """
    from app.core.config import get_settings

    return get_settings().ollama_model


class _FakeOllamaResponse:
    """A tag list that always contains the model the active settings want."""

    def __init__(self, model: str | None = None):
        self._model = model or _configured_ollama_model()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps({"models": [{"name": self._model}]}).encode("utf-8")


def _settings(*, provider="mock", fields=frozenset(), key=""):
    return SimpleNamespace(
        ai_provider=provider,
        openai_api_key=key,
        openai_model="gpt-4o-mini",
        openai_base_url="https://api.openai.com/v1",
        ollama_base_url="http://ollama.test",
        ollama_model=_configured_ollama_model(),
        model_fields_set=set(fields),
    )


def test_canonical_provider_folds_run_path_and_legacy_spelling():
    """
    Stored labels carry the path that produced the run, not just the vendor.

    `agents/graph.py` stamps `langgraph:<provider>`, so a fold that only knows
    the bare names strands every real agent run in a bucket the AI Ops
    comparison table never looks up — it reports "not run" while the runs sit
    in the table.
    """
    from app.assessment.provider_state import (
        VALID_PROVIDERS,
        canonical_provider,
    )

    assert canonical_provider("langgraph:openai_compatible") == "openai_compatible"
    assert canonical_provider("langgraph:mock") == "mock"
    assert canonical_provider("langgraph:ollama") == "ollama"
    assert canonical_provider("openai") == "openai_compatible"
    assert canonical_provider("OpenAI_Compatible") == "openai_compatible"
    assert canonical_provider(None) == "mock"

    for name in VALID_PROVIDERS:
        assert canonical_provider(name) == name
        assert canonical_provider(f"langgraph:{name}") == name


def test_auto_provider_prefers_ollama_when_available(monkeypatch):
    from app.assessment import provider_state

    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.setattr(provider_state, "get_settings", lambda: _settings(fields=set()))
    monkeypatch.setattr(
        provider_state.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _FakeOllamaResponse(),
    )

    check, source, configured = provider_state.effective_provider_check()
    assert source == "auto_default"
    assert configured is None
    assert check.provider == "ollama"
    assert check.ok is True


def test_auto_provider_falls_back_to_openai_then_mock(monkeypatch):
    from app.assessment import provider_state

    def fail_ollama(*_args, **_kwargs):
        raise OSError("down")

    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.setattr(
        provider_state,
        "get_settings",
        lambda: _settings(fields=set(), key="sk-test"),
    )
    monkeypatch.setattr(provider_state.urllib.request, "urlopen", fail_ollama)

    check, source, _configured = provider_state.effective_provider_check()
    assert source == "auto_default"
    assert check.provider == "openai_compatible"
    assert check.ok is True

    monkeypatch.setattr(
        provider_state,
        "get_settings",
        lambda: _settings(fields=set(), key=""),
    )
    check, _source, _configured = provider_state.effective_provider_check()
    assert check.provider == "mock"
    assert check.ok is True


def test_explicit_env_provider_preserved_even_when_ollama_available(monkeypatch):
    from app.assessment import provider_state

    monkeypatch.setenv("AI_PROVIDER", "mock")
    monkeypatch.setattr(provider_state, "get_settings", lambda: _settings())
    monkeypatch.setattr(
        provider_state.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _FakeOllamaResponse(),
    )

    check, source, configured = provider_state.effective_provider_check()
    assert source == "env_default"
    assert configured == "mock"
    assert check.provider == "mock"


@pytest_asyncio.fixture
async def client():
    from app.assessment.provider_state import set_runtime_provider
    from app.core.config import get_settings
    from app.db.session import _asyncpg_dsn, apply_schema, engine
    from app.db.seed import seed_minimal
    from app.db.vector import close_vector_pool
    import asyncpg
    import os

    settings = get_settings()
    try:
        conn = await asyncpg.connect(_asyncpg_dsn(settings.database_url))
        await conn.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Postgres unreachable: {exc}")

    os.environ["AI_PROVIDER"] = "mock"
    os.environ["EMBEDDING_PROVIDER"] = "mock"
    get_settings.cache_clear()
    set_runtime_provider(None)

    await close_vector_pool()
    await engine.dispose()
    await apply_schema()
    await seed_minimal()
    await _cleanup_vessel()

    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        await session.execute(text("DELETE FROM ai_ops_events"))
        await session.commit()

    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    set_runtime_provider(None)
    await close_vector_pool()
    await engine.dispose()


@pytest.mark.asyncio
async def test_provider_get_defaults_to_env(client: AsyncClient):
    resp = await client.get("/ai-ops/provider")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["active_provider"] == "mock"
    assert body["active_model"] == "langgraph-mock-v1"
    assert body["source"] == "env_default"
    assert body["env_default"] == "mock"
    assert body["connection"]["ok"] is True
    assert set(body["available"]) == {"mock", "ollama", "openai_compatible"}


@pytest.mark.asyncio
async def test_provider_put_set_and_clear(client: AsyncClient, monkeypatch):
    from app.assessment import provider_state

    monkeypatch.setattr(
        provider_state.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _FakeOllamaResponse(),
    )

    resp = await client.put("/ai-ops/provider", json={"provider": "ollama"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["active_provider"] == "ollama"
    assert body["source"] == "runtime_override"
    assert body["connection"]["ok"] is True

    # GET reflects the override
    body = (await client.get("/ai-ops/provider")).json()
    assert body["active_provider"] == "ollama"

    # Clearing returns to the env default
    resp = await client.put("/ai-ops/provider", json={"provider": None})
    assert resp.status_code == 200
    body = resp.json()
    assert body["active_provider"] == "mock"
    assert body["source"] == "env_default"


@pytest.mark.asyncio
async def test_provider_connection_test_and_switch_failure(client: AsyncClient, monkeypatch):
    from app.assessment import provider_state

    def fail_ollama(*_args, **_kwargs):
        raise OSError("down")

    monkeypatch.setattr(provider_state.urllib.request, "urlopen", fail_ollama)

    probe = await client.post("/ai-ops/provider/test", json={"provider": "ollama"})
    assert probe.status_code == 200, probe.text
    assert probe.json()["ok"] is False

    resp = await client.put("/ai-ops/provider", json={"provider": "ollama"})
    assert resp.status_code == 400
    assert "connection failed" in resp.json()["detail"]

    body = (await client.get("/ai-ops/provider")).json()
    assert body["active_provider"] == "mock"


@pytest.mark.asyncio
async def test_provider_put_rejects_unknown(client: AsyncClient):
    resp = await client.put("/ai-ops/provider", json={"provider": "gpt5"})
    assert resp.status_code == 400
    assert "gpt5" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_runtime_provider_stamped_on_enqueued_job(
    client: AsyncClient, monkeypatch
):
    """The AI Ops selection lands durably on the assessment row."""
    from app.db.session import SessionLocal
    from app.assessment.orchestrator import enqueue_for_review, orchestrator
    from app.reviews.repository import get_review
    from app.assessment import provider_state

    monkeypatch.setattr(
        provider_state.urllib.request,
        "urlopen",
        lambda *_args, **_kwargs: _FakeOllamaResponse(),
    )

    await client.put("/ai-ops/provider", json={"provider": "ollama"})

    async with SessionLocal() as session:
        rev = await session.execute(
            text(
                """
                INSERT INTO reviews (asset_id, state, owner_id, triggered_by)
                VALUES (
                    CAST(:asset AS uuid), 'assessing',
                    CAST('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AS uuid), 'test'
                )
                RETURNING id
                """
            ),
            {"asset": str(VESSEL_A)},
        )
        review_id = rev.scalar_one()
        await session.commit()
        review = await get_review(session, review_id)
        assessment_id = await enqueue_for_review(session, review)
        assert assessment_id is not None

        row = await session.execute(
            text(
                """
                SELECT provider_override FROM assessments
                WHERE id = CAST(:id AS uuid)
                """
            ),
            {"id": str(assessment_id)},
        )
        assert row.scalar_one() == "ollama"
    orchestrator.drain()


@pytest.mark.asyncio
async def test_events_listing_newest_first(client: AsyncClient):
    await _seed_mixed_assessments()
    resp = await client.get("/ai-ops/events?limit=10")
    assert resp.status_code == 200, resp.text
    events = resp.json()
    assert len(events) == 4
    for e in events:
        assert e["provider"] == "mock"
        assert e["status"] in ("complete", "failed")
        assert "recorded_at" in e
    stamps = [e["recorded_at"] for e in events]
    assert stamps == sorted(stamps, reverse=True)


@pytest.mark.asyncio
async def test_summary_includes_provider_comparison_rows(client: AsyncClient):
    await _seed_mixed_assessments()
    resp = await client.get("/ai-ops/summary")
    assert resp.status_code == 200, resp.text
    rows = {row["provider"]: row for row in resp.json()["providers"]}
    assert set(rows) == {"mock", "ollama", "openai_compatible"}
    assert rows["mock"]["status"] == "measured"
    assert rows["mock"]["assessment_count"] == 4
    assert rows["mock"]["total_tokens"] is not None
    assert rows["ollama"]["status"] in {"not_run", "unavailable"}
    if rows["openai_compatible"]["status"] != "measured":
        assert rows["openai_compatible"]["mean_latency_ms"] is None


@pytest.mark.asyncio
async def test_provider_comparison_folds_langgraph_stamped_runs(
    client: AsyncClient,
):
    """
    Real agent runs land under `langgraph:<provider>` and must still be counted.

    Regression guard: `_seed_mixed_assessments` only ever wrote the bare `mock`
    label, so the comparison table could group by the raw provider column and
    still look correct in tests while reporting "not run" for every live
    provider in the product.
    """
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        review_id = (
            await session.execute(
                text(
                    """
                    INSERT INTO reviews (asset_id, state, owner_id, triggered_by)
                    VALUES (
                        CAST(:asset AS uuid), 'closed',
                        CAST(:owner AS uuid), 'test'
                    )
                    RETURNING id
                    """
                ),
                {
                    "asset": str(VESSEL_A),
                    "owner": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                },
            )
        ).scalar_one()

        # Same vendor, two stored labels — one prefixed, one bare.
        rows = [
            ("langgraph:openai_compatible", "gpt-4o-mini", "complete", 100, 200),
            ("langgraph:openai_compatible", "gpt-4o-mini", "complete", 100, 400),
            ("openai_compatible", "gpt-4o-mini", "failed", None, None),
        ]
        for provider, model, status, tokens, latency in rows:
            await session.execute(
                text(
                    """
                    INSERT INTO ai_ops_events (
                        assessment_id, review_id, status, provider, model,
                        tokens_in, tokens_out, cost_usd, latency_ms
                    )
                    VALUES (
                        CAST(:id AS uuid), CAST(:review_id AS uuid),
                        :status, :provider, :model,
                        :tokens, :tokens, 0.001, :latency
                    )
                    """
                ),
                {
                    "id": str(uuid4()),
                    "review_id": str(review_id),
                    "status": status,
                    "provider": provider,
                    "model": model,
                    "tokens": tokens,
                    "latency": latency,
                },
            )
        await session.commit()

    resp = await client.get("/ai-ops/summary")
    assert resp.status_code == 200, resp.text
    rows_by_provider = {r["provider"]: r for r in resp.json()["providers"]}

    # No prefixed label leaks out as its own row.
    assert set(rows_by_provider) == {"mock", "ollama", "openai_compatible"}

    row = rows_by_provider["openai_compatible"]
    assert row["status"] == "measured"
    assert row["assessment_count"] == 3
    assert row["complete_count"] == 2
    assert row["failed_count"] == 1
    assert row["model"] == "gpt-4o-mini"
    # Mean is recomputed from the combined totals, not averaged twice.
    assert row["mean_latency_ms"] == 300.0
    assert row["total_tokens"] == 400
    assert row["failure_rate"] == round(1 / 3, 4)
