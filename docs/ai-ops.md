# AI Ops — the pipeline's own instrument panel

*Current as of 24 Aug 2026. Every claim below carries a `file:line`; if the code moves, the line moves with it.*

`/ai-ops` is the page that answers **"can you trust and afford the AI that just told a supervisor to
block hot work?"** It is not about plant safety and it is not about detection accuracy — that is `/eval`.
AI Ops is about the machine that produces the assessment: which model ran, how long it took, what it
cost, how often it fell over, whether retrieval actually found evidence, and how much of the plant the
sensors can currently see.

The tour calls it *"the pit crew's view"* (`frontend/lib/tourScript.ts:634`).

| Page | Question it answers | Unit of measurement |
| --- | --- | --- |
| `/eval` | Does compound risk beat a single-sensor alarm? | hazard episodes, confusion matrix, lead time |
| `/ai-ops` | Is the pipeline healthy, honest and cheap? | assessment runs, ms, tokens, USD |
| `/operator` | What is happening in the plant right now? | assets, facts, reviews |

---

## 1. The journey — how a plant event becomes a row on this page

```
context arrives (simulator | POST /context | POST /api/ingest/webhook)
  → derived facts computed          context/derived_facts.py
  → review FSM → assessing          reviews/repository.py::transition_review()
  → job enqueued (durable queue)    assessment/orchestrator.py   [provider stamped here]
  → worker claims job               FOR UPDATE SKIP LOCKED
  → hybrid retrieval                assessment/retrieval/__init__.py:100   [mode, quality, score]
  → LangGraph agents + LLM          agents/graph.py:173                     [latency, tokens, cost, fallbacks]
  → validate + citation guard       assessment/citations.py
  → persist assessment_metadata     assessment/pipeline.py:275
  → APPEND ai_ops_events row        ai_ops/events.py:11                     ← everything on /ai-ops reads this
  → review FSM → pending_decision
```

Two things are worth internalising because almost every metric on the page follows from them:

**One row per assessment, written once, at the end.** `record_ai_ops_event()` is called from exactly one
place — `assessment/pipeline.py:362`, inside `_persist_metadata()` — and only for terminal outcomes
(`ai_ops/events.py:31` drops anything that is not `complete` or `failed`). A run that is still
generating has no row. Retries inside a single run do **not** produce extra rows: the loop at
`assessment/pipeline.py:648` retries the graph up to `assessment_max_retries` (default 1, so 2 attempts
total — `core/config.py:40`) and only the final outcome is written. The insert is
`ON CONFLICT (assessment_id) DO UPDATE` (`ai_ops/events.py:49`), so `assessment_id` is a natural key.

**Manual assessments never appear here.** `assessment/manual.py` writes an assessment with
`assessment_type='manual'` (`assessment/manual.py:166`) and never calls `record_ai_ops_event`. AI Ops
counts the AI path only — which is the point, since it is measuring the AI.

### The table behind the page

`backend/app/db/schema.sql:264`:

```sql
ai_ops_events (
  assessment_id UUID UNIQUE,  review_id UUID,
  status TEXT,                -- complete | failed
  provider TEXT, model TEXT,  -- stamped with the *path*: 'langgraph:ollama', 'mock', ...
  tokens_in INT, tokens_out INT, cost_usd REAL, latency_ms INT,
  retrieval_mode TEXT, retrieval_score REAL,
  failure_reason TEXT,        -- validation | provider_error
  llm_attempt_count INT, llm_fallback_count INT, degraded BOOLEAN,
  recorded_at TIMESTAMPTZ
)
```

Three properties of this log matter for reading the page:

1. **It is append-only and all-time.** Nothing on `/ai-ops` is windowed to "today" except the cost
   projection and the latency percentiles. A bad afternoon three weeks ago is still in your success rate.
2. **It survives demo reset.** `simulator/engine.py:39` deliberately excludes `ai_ops_events` from the
   FK-safe wipe. That is why the page prints *"all-time history (not cleared on demo reset)"*
   (`AIOpsDashboard.tsx:825-831`) — the KPI history is real accumulated operation, not one demo run.
3. **It was backfilled once.** `schema.sql:294` seeds the log from historical `assessment_metadata` rows
   (`ON CONFLICT DO NOTHING`) so an existing dev DB does not read as if the platform had never run.

### How the page fetches

`AIOpsDashboard.tsx:152-176` fires four requests in parallel on mount and on the Refresh button:

| Call | Endpoint | Code |
| --- | --- | --- |
| `fetchAiOpsSummary()` | `GET /ai-ops/summary` | `liveApi.ts:585`, `ai_ops/routes.py:99` |
| `fetchAiOpsEvents(12)` | `GET /ai-ops/events?limit=12` | `liveApi.ts:645`, `ai_ops/routes.py:82` |
| `fetchProviderState()` | `GET /ai-ops/provider` | `liveApi.ts:606`, `ai_ops/routes.py:46` |
| `fetchCostProjection()` | `GET /ai-ops/cost-projection` | `liveApi.ts:590`, `ai_ops/routes.py:91` |

**The page does not subscribe to the WebSocket.** Unlike the twin, it has no `useRealtimeEvents` hook —
it is mount-fetch plus a manual Refresh. During a live demo, run the scenario first, then Refresh.

---

## 2. The page, section by section

### 2.1 Header and provider band — *which brain is actually plugged in*

`AIOpsDashboard.tsx:229-353`.

The provider control is the only **write** on this page. Selecting a provider does two calls
(`AIOpsDashboard.tsx:182-216`): `POST /ai-ops/provider/test` first, and only on success
`PUT /ai-ops/provider`. A provider that fails its connection check is never made the default — the error
surfaces instead.

Provider resolution has three sources, in priority order (`assessment/provider_state.py:160`):

| `source` | Means | Scope |
| --- | --- | --- |
| `runtime_override` | set from this page | **process-local**, resets on API restart (`provider_state.py:26`) |
| `env_default` | `AI_PROVIDER` explicitly set in env/`.env` | until env changes |
| `auto_default` | nothing set → try Ollama, then OpenAI-compatible, then mock (`provider_state.py:151`) | per resolution |

The **Connection** field is a live check, not a config read (`provider_state.py:62`):

- `mock` → `available`, always ok. Deterministic local fallback, no network call at all.
- `openai_compatible` → `configured` if an API key exists, else `unconfigured`. It does **not** call the API.
- `ollama` → actually HTTP-GETs `{OLLAMA_BASE_URL}/api/tags` with a 3s timeout, and further checks the
  wanted model is pulled → `connected` / `unavailable` / `missing_model`.

The **LangSmith chip** is on only when `LANGCHAIN_TRACING_V2` *and* `LANGCHAIN_API_KEY` are both set
(`ai_ops/service.py:83-90`, defaults off at `core/config.py:118-119`). LangSmith is per-run trace
debugging only; **no metric on this page comes from LangSmith** — they all come from the local DB
(`data_source: "local_db"`, `ai_ops/schemas.py:53`).

> **Demo caveat.** The default provider is `mock` (`core/config.py:33`), which returns `None` from
> `get_chat_model()` (`agents/llm.py:37-38`) — no network call, deterministic template narration. On mock
> the page is honest but quiet: zero tokens, zero cost, zero LLM attempts. Everything reads "perfect"
> because nothing risky happened. If a judge asks "what does this look like under a real model", switch
> the provider to Ollama or OpenAI-compatible and run a scenario, or show `docs/model-bench.md`, which was
> produced against all three.

### 2.2 Hero row — the five numbers

`AIOpsDashboard.tsx:355-398`.

| Hero | Formula | Source |
| --- | --- | --- |
| **Success rate** | `complete_count / total_assessments`, all-time | `service.py:321` |
| **Latency p50** | median `latency_ms` over the last **500** completed runs | `service.py:343-355`, window `service.py:24` |
| **Total tokens** | `SUM(tokens_in) + SUM(tokens_out)` over completed runs | `service.py:294-301` |
| **Total cost** | `SUM(cost_usd)` over completed runs | `service.py:302-305` |
| **Blind channels** | `blind / total assets`, live sensor coverage | `service.py:375-379` |

Each is unpacked below.

---

### 2.3 Reliability panel — *did the run finish, and did the model really run?*

`AIOpsDashboard.tsx:401-468`.

#### Success rate
`complete / total` over every row in the log (`service.py:266-268, 321`). A run is `failed` only when the
graph raised on every attempt (`pipeline.py:648-676`). Colour thresholds are UI-side:
≥95% good, ≥85% warn, else bad (`AIOpsDashboard.tsx:51-55, 360`).

#### Failed / Validation failures / Provider errors
`failed_count` splits by `failure_reason`, classified at `pipeline.py:41-52`:

- **`validation`** — the exception chain contains a pydantic `ValidationError`; the model produced output
  that did not satisfy `AssessmentResult` after retries. This is the "the LLM lied about the shape" bucket.
- **`provider_error`** — everything else: timeouts (`agent_timeout_seconds`, default 45s,
  `core/config.py:126`), API errors, connection failures.

The split is what makes this diagnostic rather than decorative: validation failures are a *prompt/model*
problem, provider errors are an *infrastructure* problem.

#### LLM fallback rate — the honesty metric
`SUM(llm_fallback_count) / SUM(llm_attempt_count)` across the whole log (`service.py:279-280, 328-330`).

The counts come from `agents/llm_outcomes.py:38`. Every agent node that calls the model records an
outcome of `ok` or `fallback`; a `fallback` means that agent's LLM call failed or returned nothing and the
node emitted its **deterministic template** instead. Critically, `is_live_llm_provider()`
(`llm_outcomes.py:34`) returns `False` for `mock`, so **mock runs record 0 attempts and 0 fallbacks** —
they are excluded from the denominator rather than counted as perfect successes. On a mock-only database
this bar sits at 0.0% because it is 0/0, not because a model succeeded.

This is the metric that keeps the product from overclaiming: a summary can be produced with the LLM
half-dead, and this number says how often that happened.

#### LLM-degraded
`llm_degraded_count` = completed runs where `degraded = TRUE` (`service.py:270-278`), i.e. at least one
agent fell back but the pipeline still produced a verdict (`llm_outcomes.py:59`). **Degraded is a
completed run, not a failure** — the verdict is still valid, because `risk_level` never came from the LLM
in the first place (`risk/policy.py::classify()` owns it; the LLM only writes prose).

> **Two unrelated things are called "degraded" on this page.** `llm_degraded_count` is *the model fell back
> to a template*. `degraded_channel_count` in the Blind-channels hint is *a sensor says its own reading is
> untrustworthy*. The `llm_` prefix exists precisely to keep them apart — see the comment at
> `ai_ops/schemas.py:61-64`.

#### Latency p50 / p95
Not computed in SQL. The last 500 completed runs' `latency_ms` are pulled raw (`service.py:343-354`) and
summarised by `LatencySummary` in `core/stats.py:58`, which uses linear-interpolated percentiles —
the same definition as numpy's default and Postgres `percentile_cont` (`core/stats.py:19-38`). The reason
it lives in shared Python rather than SQL is that `docs/model-bench.md` and this page must report
percentiles from the same code path.

`mean` is kept alongside p50/p95 but is the least useful of the three: one 40-second generation among
twenty fast ones moves the mean by 2s invisibly, while p95 states it plainly (`core/stats.py:4-8`).

`latency_sample_count` is how many of the 500-run window actually existed — the page prints it inside the
tooltip so a p95 computed over 3 samples cannot be mistaken for a stable measurement
(`AIOpsDashboard.tsx:367, 457`).

**What the latency actually measures — read this before quoting it.** `latency_ms` is set at
`agents/graph.py:269` from a `perf_counter` started at `agents/graph.py:232`, i.e. **the LangGraph run
only**. It excludes: time queued, hybrid retrieval, reference enrichment, citation validation, and DB
persistence. It is *agent latency*, not end-to-end time-to-verdict-on-screen. `docs/model-bench.md` states
this exclusion explicitly; the tooltip on this page currently does not (see §5).

Failed runs record `latency_ms = 0` (`pipeline.py:701`) and are excluded from every latency aggregate by
the `status = 'complete'` filter anyway.

---

### 2.4 Retrieval quality panel — *did the AI find real evidence, or make do?*

`AIOpsDashboard.tsx:470-540`. This panel is the observability surface for the hybrid retriever at
`assessment/retrieval/__init__.py:100`.

**The mechanism first.** For each run, `retrieve()`:

1. maps active fact types to source types (`retrieval/deterministic.py::source_types_for_facts`);
2. always runs the **deterministic SQL** retriever, which is the floor;
3. if RAG is on (`rag_enabled`, default true, `core/config.py:84`), vector-searches the source types in
   `rag_vector_source_types` — by default the whole seeded corpus: incidents, regulations **and** SOPs
   (`core/config.py:90`);
4. **grades** the vector hits (`assess_retrieval_quality`, `retrieval/__init__.py:31`): `good` if at least
   one hit scores ≥ `rag_score_threshold` (default **0.58**, `core/config.py:114`), `weak` if hits exist
   but none clear it, `empty` if none came back or RAG errored/timed out (3s, `core/config.py:115`);
5. `good` → `mode = "rag"` and vector hits supersede the deterministic ref for the source types they
   covered (`_merge_rag_with_det`, `retrieval/__init__.py:71`); anything else → `mode = "deterministic"`;
   no facts at all → `mode = "skipped"`.

Scores are cosine similarity clamped to 0–1: `score = max(0, min(1, 1 - distance))`
(`retrieval/rag.py:57`). `retrieval_score` stored on the event is the **best** vector score of that run
(`retrieval/__init__.py:173`) — stored regardless of which mode won, which is what makes the "vector best
0.41 < gate 0.58" trace line possible.

| Metric | Formula | Source |
| --- | --- | --- |
| **RAG hit rate** | `rag_count / retrieval_ran_count` | `service.py:281-287, 322` |
| **RAG fallback rate** | `deterministic_count / retrieval_ran_count` | `service.py:323-325` |
| **Mean retrieval relevance** | `AVG(retrieval_score)` over rows where `retrieval_mode = 'rag'` | `service.py:288-290` |
| **Retrievals run** | rows where mode is `rag` or `deterministic` (i.e. **not** `skipped`) | `service.py:285-287` |

Hit rate and fallback rate are complements over the same denominator — they sum to 1 by construction,
and `skipped` runs are in neither.

**"Last run" trace line** (`AIOpsDashboard.tsx:509-526`) does not come from the event log at all — it is
the most recent `assessment_metadata` row with a retrieval mode, joined to `assessments` by `created_at`
(`service.py:359-372`). It renders the gate decision as one sentence:
`vector best 0.41 < gate 0.58 → deterministic SQL citations · embeddings: mock`.

> **The mock-embeddings trap — this is the single most important thing to know about this panel.**
> `EMBEDDING_PROVIDER` defaults to `mock` (`core/config.py:93`), which produces a hash-derived random
> vector. A random vector essentially never clears a 0.58 similarity gate, so on a default install
> **RAG hit rate is 0% and fallback rate is 100%, permanently**. That is not a broken retriever; it is the
> quality gate working exactly as designed and refusing to feed noise to the model. Real semantic
> retrieval needs `EMBEDDING_PROVIDER=ollama` or `openai_compatible`.
> Citation coverage does not suffer either way — vector search only ever *supersedes* the deterministic
> floor, never replaces it, so every summary still cites real clause-level regulations.

---

### 2.5 Agent spend panel — *tokens and USD*

`AIOpsDashboard.tsx:542-610`.

**Where tokens come from.** Each agent node that calls the model builds a usage record
(`agents/llm.py:157`) via `extract_usage()` (`agents/llm.py:90`), which reads LangChain's standardised
`usage_metadata`, then OpenAI-style `token_usage`, then Ollama's `prompt_eval_count` / `eval_count`.
Anything it cannot parse is `(0, 0)` — token counts are *reported by the provider*, never estimated by us.
`sum_usage()` (`agents/llm.py:176`) totals them across every node in the graph, and the totals land on the
event at `agents/graph.py:290-292`.

So **Total tokens = every LLM call made by the whole multi-agent graph** for that run — domain narration
agents plus the orchestrator — not one prompt. The input/output split bar (`AIOpsDashboard.tsx:550-581`)
usually skews heavily to input, which is the RAG payload plus plant context being carried into each node.

**Where cost comes from.** `estimate_cost_usd()` at `agents/llm.py:143`:

```
cost = (tokens_in × price_in + tokens_out × price_out) / 1_000_000
```

with a small hard-coded USD-per-1M table at `agents/llm.py:11-15` — `gpt-4o-mini` (0.15 / 0.60),
`gpt-4o` (2.50 / 10.00), and a `default` (0.50 / 1.50) for any unrecognised model. **Non-OpenAI-compatible
providers return 0.0 unconditionally** (`agents/llm.py:151-152`).

> `$0` for `mock` or `ollama` means **unpriced, not free**. Ollama's real cost is the machine it runs on.
> `docs/model-bench.md` makes the same point in its own words — quote it that way to a judge.

The price table is a static snapshot and will drift from vendor pricing; it is an *estimate* label on the
page for that reason (`AIOpsDashboard.tsx:379`).

---

### 2.6 Projected cost — *what does this cost at plant scale?*

`AIOpsDashboard.tsx:613-676`, backed by `service.py:442`.

```
trailing_cost = SUM(cost_usd) WHERE recorded_at >= now() - 30 days AND status = 'complete'
daily_rate    = trailing_cost / 30
projection(m) = daily_rate × {3mo: 91, 6mo: 182, 12mo: 365} days
```

(`service.py:471-494`; window constant `service.py:27`, horizons `service.py:456`.)

Two deliberate design choices:

**It short-circuits on the active provider before touching the log** (`service.py:452-469`). If the
effective provider is not paid (`mock` / `ollama`), it returns zeros with `is_paid_provider: false` and the
page says so in plain words (`AIOpsDashboard.tsx:670-674`). The reason is stated in the docstring
(`service.py:443-451`): the all-time log can contain rows stamped with a paid provider from earlier
experiments or the schema backfill, and extrapolating those into a projection for a plant that is not
currently spending would be a fabricated number.

**It is straight-line arithmetic, not a forecast**, and the page says that too. It does not model demo
resets, seasonal load, or price changes.

*Caveat worth knowing:* the divisor is always 30, even when the log is only a few days old — so on a fresh
database the daily rate (and every projection) is **understated** roughly in proportion to how young the
log is. For a defensible per-assessment × volume argument, use `docs/model-bench.md`, which projects from
measured per-assessment cost against a stated 400-assessments/day assumption.

---

### 2.7 Provider comparison — *the swappability argument, in numbers*

`AIOpsDashboard.tsx:678-757`, backed by `_provider_rows()` at `service.py:93`.

Every row in `VALID_PROVIDERS` (`provider_state.py:24` — `mock`, `ollama`, `openai_compatible`) is always
rendered, with one of three statuses:

- **Measured** — the log has rows for it; all numeric columns are filled.
- **Not run** — provider is available but has no assessments; columns read *"Not measured"* rather than 0.
- **`unconfigured` / `unavailable` / `missing_model`** — the live connection check failed; the reason is in
  the chip tooltip (`service.py:205-218`).

The distinction between "0" and "not measured" is deliberate and is the honest-metrics rule applied at the
cell level: an empty sample renders `—`, never a zero that looks like a measurement (`core/stats.py:22-25`).

**The label-folding subtlety.** Events are stamped with the *path* that produced them, not the vendor:
`agents/graph.py:288` writes `langgraph:<provider>`, and `openai` is a legacy spelling of
`openai_compatible`. So one vendor can appear under several raw labels. SQL groups by the raw label and
returns sums plus their counts; Python then folds them onto canonical keys with `canonical_provider()`
(`provider_state.py:38`) and recomputes means from the **combined totals** rather than averaging averages
(`service.py:139-177`, docstring at `service.py:94-103`). Grouping on the raw label alone would strand
every prefixed run in a bucket the table never looks up. `tests/test_ai_ops_provider.py:349` locks this in.

Per-row formulas:

| Column | Formula | Notes |
| --- | --- | --- |
| Assessments | `complete_count / assessment_count` | `assessment_count` includes failed runs |
| Latency p50/p95 | percentiles over that provider's slice of the **global last-500** completed sample | `service.py:179-198` |
| Avg latency | `latency_sum / latency_n` over **all** completed runs for that provider, all-time | `service.py:223-225` |
| Tokens | `SUM(tokens_in + tokens_out)` over completed runs | `service.py:122-127` |
| Cost / run | `cost_sum / cost_n` over completed runs | `service.py:227` |
| Failure rate | `failed_count / assessment_count` | `service.py:256` |
| Model | most recent non-null model across the folded labels, else the configured model | `service.py:171-177` |

> Note the two latency columns use **different samples**: p50/p95 come from the trailing 500-run window
> (so a provider you last used a month ago may show `—` there while still showing an average), and Avg
> latency is all-time. That is intentional — the average is a stable historical figure, the percentiles are
> "what is it doing lately" — but do not read them as decompositions of each other.

**What this table is for.** Read alongside `docs/model-bench.md`'s invariance table — same inputs, every
provider, same `risk_level` — it is the evidence for the strongest architectural claim in the project:
*the model is swappable because it was never the thing deciding.* The verdict comes from
`risk/policy.py::classify()`; the model writes prose. This table shows the model changing latency, tokens
and cost while the safety behaviour does not move.

---

### 2.8 Recent assessments — *the raw log*

`AIOpsDashboard.tsx:759-823`. The last 12 events, newest first (`service.py:33`, capped server-side at 100,
`service.py:49`). Every row is one assessment, stamped with the provider and model that produced it, its
latency, tokens, cost, and the retrieval mode with the best vector score in parentheses.

The status chip appends `· degraded` when at least one agent fell back to a template
(`AIOpsDashboard.tsx:796-798`). This is where a demo makes the abstract concrete: run the same scenario on
two providers and show the two rows side by side.

---

## 3. Blind channels — sensor coverage, and why it is on this page

`AIOpsDashboard.tsx:382-397`, computed by `context/coverage.py:177`.

Coverage is an **orthogonal field carried alongside `risk_level`, never a fourth risk level**
(`coverage.py:4-7`). Values: `assessed | degraded | blind`. It never raises or lowers a verdict — a blind
channel withholds the *nominal* claim, because "no data" is not "safe".

Classification per asset (`coverage.py:74`), staleness first:

1. **blind** — no sensor reading has ever arrived, or the newest is older than `sensor_stale_after_seconds`
   (default **180s**, `core/config.py:73`);
2. **degraded** — a reading is current but the sensor says its own value is suspect: a fault payload, or
   confidence below `sensor_confidence_floor` (default **0.5**, `core/config.py:76`), via the pure rule
   `rule_sensor_unreliable`;
3. **assessed** — current and self-reported healthy.

"Last heard from" is a `MAX` across **both** telemetry tables — hard-ingest `context_entries` and the
always-on ambient ring `telemetry_samples` (`coverage.py:151-170`). Querying only `context_entries` made
every asset read blind, because the ambient heartbeat never writes that table. Rows from
`scripts/quick_mock_seed.py` (`provider='quick_mock'`) are excluded so a demo row cannot make an asset
read `assessed` when nothing real reported (`coverage.py:133-144`).

The hero shows `blind / asset_count`, with the degraded count in the tooltip. It belongs on AI Ops because
it is the input-side counterpart to everything else here: the rest of the page measures whether the AI ran
well; this measures whether it had anything to run on.

---

## 4. What `/ai-ops/summary` returns — full field reference

`ai_ops/schemas.py:52`. Every field, its formula, and whether the page renders it.

| Field | Formula / source | Rendered |
| --- | --- | --- |
| `total_assessments` | `COUNT(*)` of the log | subtitle |
| `complete_count` / `failed_count` | `COUNT(*) FILTER (status = …)` | yes |
| `success_rate` | `complete / total` | hero + bar |
| `validation_failure_count` | failed AND `failure_reason='validation'` | yes |
| `provider_error_count` | failed AND `failure_reason='provider_error'` | yes |
| `llm_attempt_count` | `SUM(llm_attempt_count)`, live providers only | tooltip only |
| `llm_fallback_count` | `SUM(llm_fallback_count)` | tooltip only |
| `llm_fallback_rate` | fallbacks / attempts | bar |
| `llm_degraded_count` | completed AND `degraded` | yes |
| `llm_degraded_rate` | degraded / complete (`service.py:332`) | **no — computed, never shown** |
| `rag_hit_rate` | rag / (rag + deterministic) | bar |
| `rag_fallback_rate` | deterministic / (rag + deterministic) | bar |
| `mean_retrieval_relevance` | `AVG(retrieval_score)` over `mode='rag'` rows | bar |
| `retrieval_ran_count` | mode in (rag, deterministic) | yes |
| `mean_latency_ms` | `AVG(latency_ms)` over completed, all-time | tooltip |
| `p50_latency_ms` / `p95_latency_ms` | percentiles over last 500 completed | hero + stats |
| `latency_sample_count` | size of that window | tooltip |
| `total_input_tokens` / `total_output_tokens` | `SUM(...)` over completed | yes |
| `total_cost_usd` / `mean_cost_usd` | `SUM` / `AVG` over completed | yes |
| `blind_channel_count` / `degraded_channel_count` / `asset_count` | `coverage_for_assets()` | hero |
| `last_retrieval_mode` / `_quality` / `_score` / `_embedding_model` | newest `assessment_metadata` row | trace line |
| `rag_gate_threshold` | `settings.rag_score_threshold` | trace line |
| `providers[]` | `_provider_rows()` | table |
| `langsmith_enabled` / `_project` / `_url` | env config | chip + button |
| `data_source` / `persists_across_demo_reset` | constants | footer |
| `ws_clients`, `ws_queue_depth_max`, `ws_queue_capacity`, `ws_dropped_frames` | `manager.stats()`, attached at the route edge (`routes.py:106-113`) | **no — see §5** |

---

## 5. Known gaps and copy drift (found while writing this doc)

These are stated so nobody quotes a line the code does not back. Definition-of-done rule 4 says every
user-visible claim needs a `file:line` behind it; these four are where that currently strains.

1. **WebSocket backpressure counters are served but not displayed.** `ws_clients`, `ws_queue_depth_max`,
   `ws_queue_capacity` and `ws_dropped_frames` are computed (`realtime/connection_manager.py:110`),
   attached to the response (`ai_ops/routes.py:106-113`) and typed in `ai_ops/schemas.py:87-90` — but they
   are absent from the frontend interface (`frontend/lib/liveApi.ts:172-211`) and never rendered in
   `AIOpsDashboard.tsx`. Meanwhile `docs/comprehensive-guide.md:263` and `CLAUDE.md` both state the depth
   and dropped-frame counters are *"visible live on the AI Ops page"*. Either add the panel (the data is
   already on the wire — it is a small render) or amend both docs. It is a good scalability beat to show,
   so adding the panel is the better fix.
2. **The latency tooltip overstates what is measured.** `AIOpsDashboard.tsx:367-368` says *"from job claim
   to persisted verdict"*; the number is the LangGraph run only (`agents/graph.py:232` → `:269`), excluding
   queue wait, retrieval and persistence. `docs/model-bench.md` already words this correctly — copy its
   phrasing ("agent latency — excludes retrieval, DB persistence and time queued").
3. **The relevance tooltip names the wrong corpus.** `AIOpsDashboard.tsx:506` says *"historical-incident
   chunks"*. Since W5 the vector scope defaults to incidents, regulations **and** SOPs
   (`core/config.py:90`), and the stored score is the run's *best* vector hit
   (`retrieval/__init__.py:173`), averaged across RAG-mode runs. It should read "best vector score per RAG
   run, averaged".
4. **`llm_degraded_rate` is computed and shipped but never rendered.** Either surface it next to
   `llm_degraded_count` or drop it from the payload.

---

## 6. Verifying it yourself

```bash
# 1. DB up, API up
docker compose up -d db
python scripts/dev-api.py

# 2. Produce events: run the hero scenario, then hit Refresh on /ai-ops
curl -s -X POST localhost:8000/demo/scenarios/compound_risk/run

# 3. Read the same numbers the page reads
curl -s localhost:8000/ai-ops/summary         | python -m json.tool
curl -s localhost:8000/ai-ops/events?limit=5  | python -m json.tool
curl -s localhost:8000/ai-ops/cost-projection | python -m json.tool
curl -s localhost:8000/ai-ops/provider        | python -m json.tool
```

Tests that pin this behaviour (run **one file at a time**, and confirm with `-rs` that they did not skip —
a DB-less run reports green while skipping):

```bash
cd backend && source ../.venv/bin/activate && export PYTHONPATH=/home/aahil/projects/sop-opera
python -m pytest -q -rs tests/test_ai_ops_summary.py            # summary arithmetic; survives demo reset
python -m pytest -q -rs tests/test_ai_ops_provider.py           # provider resolution, folding, events order
python -m pytest -q    tests/test_llm_fallback_observability.py # pure logic: fallback counting, mock excluded
python -m pytest -q    tests/test_model_bench.py                # bench harness
```

`tests/test_ai_ops_summary.py:157` asserts the summary math directly; `:201` asserts the log survives a
demo reset. `tests/test_ai_ops_provider.py:349` asserts `langgraph:`-stamped runs fold onto their vendor row.

---

## 7. The 60-second version, for a judge

> "The AI writes prose; a deterministic policy writes the verdict. This page proves both halves are
> healthy. Every AI assessment appends one row to an append-only log that survives demo reset — provider,
> model, latency, tokens, cost, retrieval mode and whether any agent fell back to a template. From that:
> success rate and the failure split (schema-validation vs provider error); p50/p95 agent latency, because
> a mean hides the one 40-second run a control room actually feels; an LLM-fallback rate that admits when
> the model was substituted by a template instead of pretending it ran; a RAG hit rate gated on cosine
> similarity ≥ 0.58, which currently falls back to deterministic SQL by design because mock embeddings
> should never clear a real quality gate; token and USD cost estimated from real provider-reported usage;
> and a provider comparison table showing latency and cost moving between mock, Ollama and GPT-4o-mini
> while the safety verdict does not move at all. Plus blind-channel coverage — because the honest answer
> when a sensor goes quiet is 'we cannot see', not 'it is safe'."
