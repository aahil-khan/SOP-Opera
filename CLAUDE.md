# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SOP Opera is an AI-powered **industrial safety intelligence** platform, built for the hackathon brief in `docs/archive/problem statement.md`. The premise of that brief: in incidents like the Visakhapatnam Steel Plant coke-oven explosion, the sensor data existed but no intelligence layer connected it to an operational decision in time. This project is that layer — it fuses sensors, permits, maintenance state, worker location, and shift records into a compound-risk picture, surfaces it on a live plant twin, and drives it to a recorded human decision with an audit trail.

A supervisor sees a live 2D plant twin; rules turn plant context into named facts, a multi-agent AI pipeline synthesizes those facts plus retrieved regulations/incidents/SOPs into an assessment, the human records a decision, and evidence is frozen into a report.

### What the judges score

Weighted: Business Impact 25% · Technical Excellence 25% · Scalability 20% · UX 15% · Innovation 15%. The evaluation focus is concrete and the codebase already targets it — **prefer changes that move these numbers or make them legible**:

| Judged on | Where it lives |
| --- | --- |
| Compound-risk accuracy vs single-sensor baseline, false-negative reduction | `backend/app/eval/` — `detectors.py` has `single_sensor_alarm` / `compound_alarm` / `forecast_alarm`; `metrics.py` computes the confusion matrices; results render at `/eval` and in `docs/eval-report.md` |
| Prediction lead time before incident threshold | `eval/lead_time.py` + `agents/nodes/predictive_trend.py` (OLS trend forecast) |
| Geospatial evidence quality | `graph/kg.py` (networkx, real Euclidean adjacency over `graph/floor_plan_map.json`) + `agents/nodes/spatial.py`; twin map and floor plans in `frontend/components/twin/`. **Deliberately not a scored detector input** — `eval/detectors.py` passes no observations, so spatial never affects a reported metric. Making it one requires a distance-based criterion in `eval/hazard_ground_truth.py` first; adding cross-asset cases without that would re-introduce the circular labeling W2 removed. Spatial is positioned as evidence for the supervisor, not as accuracy. |
| Regulatory coverage (OISD / Factories Act) | clause-level statutory corpus in `db/seed_embeddings.py` (`INDIAN_REGULATIONS`, each with a `clause` and primary-source `source_url`), surfaced by **deterministic SQL** and validated by `assessment/citations.py`; measured by `eval/coverage.py` |
| Scalability | durable `SKIP LOCKED` assessment queue, gated agent fan-out, webhook ingest |

The headline story is the VSP coke-oven scenario (`simulator/scenarios/vsp_coke_oven.yaml`): the compound engine blocks while gas is still **below** the single-sensor critical threshold.

### Docs

`docs/archive/implementation-guide.md` and `docs/archive/Technical Design Spec.md` describe the original design. They are stale in places — the product has moved past them, and their "frozen decisions" are not all being followed. **Treat them as background, not as rules; when they conflict with the user's instruction or the current code, the user and the code win.** `docs/comprehensive-guide.md` is the current, verified project reference. `docs/architecture-ingest.md` (ingest/assessment scaling) and `docs/eval-report.md` (current metrics) are current. `docs/todo.md` is the live working list.

## Commands

Everything runs from the repo root with the root `.venv` (Python) and `frontend/node_modules` (Node).

```bash
# Full stack (creates .env, starts Postgres via docker, installs deps, runs API + UI)
./scripts/run-linux.sh          # or run-mac.sh / run-windows.ps1

# Just the DB
docker compose up -d db         # pgvector/pgvector:pg16 on localhost:5433

# Backend only
python scripts/dev-api.py       # uvicorn app.main:app --reload on :8000

# Frontend only
cd frontend && npm run dev      # :3000; predev runs sync-shared
```

### Tests

```bash
# Backend — must run from backend/ with the repo root on PYTHONPATH (for `shared.python`)
cd backend && source ../.venv/bin/activate && export PYTHONPATH=/path/to/sop-opera
python -m pytest -q                        # whole suite
python -m pytest -q tests/test_decisions.py            # single file
python -m pytest -q tests/test_state_machine.py -k transition   # single test

# Frontend — plain node:test files in frontend/lib/*.test.ts, no runner configured in package.json
cd frontend && npx tsx --test lib/*.test.ts
```

Backend tests split into two kinds. Pure-logic ones (`test_state_machine.py`, `test_agent_routing.py`, `test_agents_langgraph.py`, `test_ambient.py`, `test_config_thresholds.py`, `test_scenario_dsl.py`) need nothing and finish in under a second. The rest spin an `httpx` `ASGITransport` client over the real app against Postgres on `:5433`, applying `schema.sql` and seeding per fixture — these are slow and share global tables, so **run them a file at a time** and prefer the pure-logic tests for fast iteration. Some of them (e.g. `test_ai_ops_summary.py`, `test_assessment_pipeline.py`, `test_assets_endpoint.py`) can hang rather than fail when the DB state is contended; if a run stalls, that's the cause, not your change.

### Shared contracts

`shared/` (root) is the **source of truth** for TS contracts and fixtures. `frontend/shared/` is a generated copy — never edit it. Turbopack rejects symlinks and imports outside the Next.js root, hence the copy.

```bash
node scripts/sync-shared.mjs    # shared/{enums,schemas,api_contracts}.ts + fixtures.json → frontend/shared/
```

Runs automatically on `npm run dev` / `npm run build`. The Python mirror is `shared/python/schemas.py` — when you change an enum or contract, update **both** the TS file and the Python mirror; they are hand-kept in sync, not generated.

## Architecture

### The spine

```
context arrives (simulator | manual POST /context | POST /api/ingest/webhook)
  → persisted + derived-fact rules run
  → review FSM → assessing
  → orchestrator claims job → hybrid retrieval → LangGraph agents + LLM → validate → persist
  → review FSM → pending_decision  (ws: assessment.completed)
  → supervisor decides → evidence frozen → tasks created
  → close → report generated; audit entries throughout
```

### Backend (`backend/app`, FastAPI + SQLAlchemy async + asyncpg)

Layering per domain package: `routes.py` (HTTP) → `service.py` (orchestration/business rules) → `repository.py` (SQL). SQL is raw `text()` against `sqlalchemy.ext.asyncio` — there are no ORM models. Response/request shapes come from `shared/python/schemas.py` where they are contract types, and local `schemas.py` for endpoint-only shapes.

Domains: `reviews` (lifecycle, comments, ownership, concerns), `context` (ingest + derived facts), `assessment` (orchestrator, pipeline, providers, retrieval, embeddings, manual fallback), `agents` (LangGraph multi-agent), `decisions`, `tasks` (follow-through work generated from a decision), `reports`, `notifications`, `audit`, `graph` (knowledge graph / spatial neighbors), `simulator` (scripted scenarios + ambient telemetry), `eval` (detector metrics / lead-time harness), `ai_ops` (pipeline health), `config` (thresholds), `auth`, `realtime`.

Route prefixes are inconsistent by design/history: most domains are unprefixed (`/reviews`, `/demo`, `/graph`), while `config`, `eval`, `ingest`, and `assessment-jobs` sit under `/api/...`. Check `backend/app/main.py` for the router list.

### How the pieces are currently wired

Not policy — just the load-bearing structure. Changing any of it is fine, but know what you're cutting through, because several of these are single choke points with side effects attached.

1. **`transition_review()` in `reviews/repository.py` is the only writer of `reviews.state`.** It validates against the pure table in `reviews/state_machine.py`, records audit, broadcasts `review.status_changed`, and fires side effects by target state (`assessing` → enqueue assessment, `reopened` → cancel open tasks, `closed` → generate report). A raw `UPDATE reviews SET state` silently skips all of that.
2. **Fact detection is deterministic Python, not the LLM.** Pure `rule_*` functions over `ContextEntryView` in `context/derived_facts.py`, thresholds injected from settings. This is what the eval harness measures, so a fact moved into LLM judgement stops being scoreable against the single-sensor baseline. Purity is load-bearing: rules see only the context entry, never asset metadata or the knowledge graph. That is why `rule_zone_occupied` reads a *reported hazard classification* (`worker_location.payload["zone"]`, values `hazardous`/`safe`) rather than comparing against `assets.zone`, which is a plant-area label (`coke-oven-battery`, …). Same field name, different meanings — read the docstring on that rule before "fixing" it.
2b. **`risk/policy.py` is the only place facts become a verdict.** `classify()` maps facts to hazard dimensions (atmosphere · ignition/energy · exposure · control failure) and blocks on a *pathway*, not a fact count. The agent orchestrator, `reviews/service.py` and `eval/detectors.py` all delegate to it — do not reimplement the gate anywhere, or the shipped verdict and the measured verdict will drift. The LLM never writes `risk_level`; it only writes `summary`.
3. **Retrieval is orchestrator-driven, not model-driven.** `assessment/retrieval/` tries pgvector first, applies a quality gate, then falls back to deterministic SQL. Two things to know before describing this as RAG: `RAG_VECTOR_SOURCE_TYPES` is **incidents-only**, so regulations and SOPs are *never* vector-searched in any config; and with the default `EMBEDDING_PROVIDER=mock` (a hash-derived random vector) the quality gate never passes, so the deterministic path always wins. That is a deliberate trade for guaranteed citation coverage — just do not call the regulatory path RAG.
3b. **A summary may only cite what was retrieved.** `assessment/citations.py` checks citation-shaped tokens in generated prose against the enriched references and strips unsupported ones. Without it the only guard was a prompt instruction.
4. Generation is retried `assessment_max_retries` times, then fails *visibly* — the supervisor retries, switches provider, or writes a manual assessment (`assessment/manual.py`). The seam to patch in tests is `assessment.pipeline.run_agent_assessment`.
5. WebSocket broadcasts go to **all** clients; the frontend filters for relevance. There is no per-client queue or backpressure, so one stalled client blocks the send loop.
6. **`audit/service.py` is the only writer of `audit_entries`, and every entry is hash-chained** (`audit/chain.py`). Appends take a transaction-scoped advisory lock so concurrent writers cannot fork the chain; `GET /audit/verify` recomputes it and reports breaks. Inserting an audit row by any other path leaves an unverifiable gap.

### Assessment pipeline

`assessment/orchestrator.py` is a durable Postgres-backed queue: an in-memory `asyncio.Queue` provides the low-latency wake path, while workers also claim rows with `FOR UPDATE SKIP LOCKED` so jobs survive restarts and N workers (`assessment_worker_count`) never double-run. `recover_pending()` resets stranded `generating` rows at boot.

`assessment/pipeline.py` executes one job: retrieve → `agents/graph.py` → validate → persist → transition. The LangGraph `StateGraph` fans out **selectively** — `agents/routing.py` gates source agents (scada/permit/maintenance/workforce) on matching facts or context categories, spatial and predictive-trend on elevated signals, incident-pattern and shift-handover on elevated/blocking verdicts. A nominal review is orchestrator-only. Agent steps stream to the UI Brain panel as `agent.step` events.

LLM selection is `agents/llm.py` `get_chat_model()`: `mock` (default — returns `None`, so **no network call is made and every narration is a deterministic template**), `openai_compatible`, `ollama`. The UI surfaces this as "deterministic narration · no LLM configured" rather than implying reasoning. Embeddings (`assessment/embeddings/`): `mock` / `local` / `openai_compatible`. Selected by `AI_PROVIDER` / `EMBEDDING_PROVIDER`.

There was a second, parallel `assessment/providers/` package implementing the same idea with structured output; nothing reached it and it has been deleted. If you need to change how the LLM is called, `agents/llm.py` is the only seam.

### Database

No migration system. `backend/app/db/schema.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`) and applied on every boot by `apply_schema()`, followed by `seed_minimal()` and `seed_embeddings()`. **Schema changes go in `schema.sql` as additive, idempotent statements** — new columns are appended to the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` block at the bottom of the file rather than edited into the original `CREATE TABLE`, so existing dev databases pick them up on restart. The API deliberately boots even when Postgres is unreachable (lifespan soft-fails).

`knowledge_chunks.embedding` is `vector(1536)`; `db/vector.py` keeps a separate asyncpg pool for pgvector queries.

### Realtime

`realtime/connection_manager.py` is a single broadcast-to-all manager. Envelope is always `{type, payload, ts}`. Event names are frozen in `shared/api_contracts.ts` (`WS_EVENTS`) plus `agent.step` and ambient telemetry events emitted by `simulator/ambient.py`. `/ws` also echoes inbound text (a dev seam).

### Frontend (`frontend/`, Next.js 15 App Router + React 19 + Zustand)

`app/page.tsx` is the Digital Twin (the hero surface); other routes are `supervisor`, `reviews/[id]`, `reports/[id]`, `notifications`, `handover`, `ai-ops`, `eval`, `landing`, `login`. `app/layout.tsx` mounts `AppShell`, `ThemeProvider`, `AppToaster`, and `RealtimeProvider`.

`lib/liveStore.ts` (Zustand) is the single client-side source of truth: `hooks/useRealtimeEvents.ts` holds one reconnecting WebSocket that funnels every domain event into `handleRealtimeEvent`, which refetches through the typed client in `lib/liveApi.ts`. Components subscribe with narrow selectors — this store is large and hot, so **select the minimum slice**; recent work specifically cut re-renders from hover, the overview feed, and the notification badge.

Styling is CSS Modules colocated next to each component (`Foo.tsx` + `Foo.module.css`) over design tokens in `app/globals.css` (e.g. `--domain-sensors`, consumed via `lib/domains.ts`). Auth is a cookie-carried actor (`sop_actor`, see `backend/app/auth/routes.py` and `lib/actorCookie.ts`) — seeded users, no real identity provider.

## Configuration

All backend settings live in `backend/app/core/config.py` (pydantic-settings, reads root `.env` then `backend/.env`); `.env.example` documents every key. Sensor/rule thresholds are backend-owned and exposed to the UI via `GET /api/config/thresholds` — do not duplicate threshold numbers in frontend code, read them from `lib/sensorThresholds.ts` which hydrates from that endpoint.

Two threshold tiers exist and mean different things: **elevated** is the compound-engine early warning (sub-critical co-occurrence), **critical** is the single-sensor incident line used as the baseline for false-negative/lead-time eval. Critical must stay above elevated.

## Domain model as it stands

Three objects with distinct owners: **Review** (platform lifecycle) · **Assessment** (AI or manual author) · **Decision** (human supervisor). The AI assesses and recommends; the human's decision is the binding act, and outcomes are `approved` / `approved_with_conditions` / `blocked`. There is no execution/completion state — physical work happens outside the platform, though decisions do spawn follow-through `review_tasks`.

Plant input has three shapes: scripted YAML replay (`simulator/scenarios/*.yaml`, deterministic — this is what demos run), a randomized engine (`simulator/random_engine.py`), and always-on ambient telemetry (`simulator/ambient.py`, deliberately low-signal background gauges with a rare coincidence-failure roll). All three land on the same `ingest_context` seam a real SCADA/PTW integration would use.
