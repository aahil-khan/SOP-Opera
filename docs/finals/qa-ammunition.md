# Q&A Ammunition — Finals, 25 Aug 2026

Companion to `docs/finals/pitch.md` (the 7-minute script). Every anticipated judge question,
grouped by theme, each answer ending in the exact file:line behind it. Everything here was
verified against current code — not from an older doc's description of what should exist.

**Three standing rules for the panel:**

1. **Lead with the bolded line.** Under live pressure that first sentence is often all you get
   to say. The paragraph under it is depth for a follow-up, not the answer.
2. **Name gaps before a judge finds them.** Several answers below are "we don't have that."
   Say it plainly and say what would close it. A judge probing a stretched claim costs far more
   than a volunteered gap.
3. **Never invent a citation.** If you don't know, say: *"I don't have that number in front of
   me — what we do have is X, and I can show you where it lives."* That is a strong answer here.

---

## Index

**A · The AI core** — [A1 Why not GPT-4](#a1) · [A2 Just a rules engine?](#a2) · [A3 Trust one agent?](#a3) · [A4 Why LangGraph](#a4) · [A5 LLM hallucination](#a5) · [A6 Prompt injection](#a6) · [A7 Why not ML](#a7) · [A8 Where the 4 dimensions came from](#a8) · [A9 Who tunes thresholds](#a9)

**B · Evidence & rigor** — [B1 Real data?](#b1) · [B2 False-alarm rate](#b2) · [B3 Eval circularity](#b3) · [B4 The 28 minutes](#b4) · [B5 The 593 cases](#b5) · [B6 Geospatial not scored](#b6) · [B7 Is it really RAG?](#b7)

**C · Deployment & scale** — [C1 Instrumented-plant assumption](#c1) · [C2 Sensor down](#c2) · [C3 Deployment effort](#c3) · [C4 Scale](#c4) · [C5 Multi-plant](#c5) · [C6 Latency & throughput](#c6) · [C7 Postgres dies](#c7) · [C8 LLM down](#c8) · [C9 Why pgvector](#c9) · [C10 No migrations](#c10) · [C11 On-prem / air-gapped](#c11)

**D · Legal, regulatory, liability** — [D1 Is this an SIS/SIL system?](#d1) · [D2 Who is liable](#d2) · [D3 DGMS routing](#d3) · [D4 Audit admissibility / why not blockchain](#d4) · [D5 Worker-location privacy](#d5) · [D6 Security posture](#d6)

**E · Human factors & UX** — [E1 Alarm fatigue](#e1) · [E2 Disagreeing with the AI](#e2) · [E3 Vernacular UI](#e3) · [E4 Training & onboarding](#e4) · [E5 Accessibility](#e5) · [E6 Mobile](#e6) · [E7 Shift handover](#e7) · [E8 Closing with open work](#e8)

**F · Business & viability** — [F1 Business model & pricing](#f1) · [F2 Who buys it](#f2) · [F3 Where ₹50 crore came from](#f3) · [F4 The 6,500 and 60% figures](#f4) · [F5 Market size](#f5) · [F6 Competition](#f6) · [F7 The moat](#f7)

**G · Project honesty** — [G1 Discovered patterns](#g1) · [G2 What we did not build](#g2) · [G3 Brief coverage](#g3) · [G4 Real operator validation](#g4) · [G5 Demo or product](#g5) · [G6 What's next](#g6)

---

## ⚠ Highest-exposure questions — rehearse these six

These are where our answer is weakest or most attackable. Everything else we can defend cold.

| # | Question | Why it's exposed |
| --- | --- | --- |
| [B2](#b2) | False-alarm rate | **No headline FPR number exists.** Only a raw count (12/200). |
| [D1](#d1) | Is this a safety-instrumented system? | Nothing in the repo addresses it. Getting this wrong is a credibility kill with any process-safety judge. |
| [G3](#g3) | Brief bullet 5 coverage | We claim "fully covered" but the escalation chain is **not implemented** and contacts are fictional. |
| [F1](#f1) | Pricing | One modeled line (`< ₹1–2 cr/yr`). No structure, no unit economics. |
| [G4](#g4) | Have you talked to real operators? | **No.** No plant validation of any kind. |
| [F6](#f6) | Competition | No named incumbent anywhere in the repo. No comparison artifact. |

**Two known defects to fix or avoid demoing** (both verified today):

- **The Grand Tour narrates "Six domains… a lopsided hexagon" while the radar now renders seven
  wedges (a heptagon).** `frontend/lib/tourScript.ts:520,522` vs `frontend/lib/domains.ts:23-32`
  (7 ids: sensors, permits, people, evidence, response, spatial, history) and
  `frontend/components/twin/DomainRadar.tsx:38` (`const N = DOMAINS.length`). Visible during
  Act IV. Fix the copy or skip that tour step.
- **`PUT /api/config/thresholds` has neither an actor check nor an audit entry.** See [A9](#a9).

---

# A · The AI core

<a id="a1"></a>
## A1. Why not just use GPT-4?

**Out of the box we make zero LLM calls — and the verdict was never the model's job on any
provider.**

`AI_PROVIDER` defaults to `mock`, and `get_chat_model()` returns `None` for it: no network call,
every narration a deterministic template. The UI says so rather than implying reasoning —
"deterministic narration · no LLM configured." When a provider *is* configured
(`openai_compatible` or `ollama` are both wired), the separation holds: the LLM only writes the
free-text `summary`. `risk_level` is computed by deterministic policy **before** the LLM runs and
passed in as a fixed value. So the comparison isn't SOP Opera vs GPT-4 — it's that a language
model is the wrong instrument for a safety verdict you have to defend to an inspector, and we
use it only where prose is the deliverable.

**Grounded in:** `backend/app/agents/llm.py:29-38`, `backend/app/core/config.py:33`,
`backend/app/agents/nodes/orchestrator.py:420-421` (verdict first), `:425-427` (summary after),
`:481-486` (two sources), `frontend/components/assessment/AssessmentPanel.tsx:148-154`

<a id="a2"></a>
## A2. Isn't this just a rules engine?

**The rules only produce facts. What makes it a risk engine is that facts map to hazard
*dimensions*, and blocking requires a completed pathway — not a fact count.**

17 `rule_*` functions each read one context entry in isolation and emit a named fact. Those facts
map into four dimensions — atmosphere, ignition/energy, exposure, control-failure — and
`classify()` blocks on co-occurrence across complementary dimensions. The module's own docstring
rejects the predecessor design by name: the old rule was `len(rule_facts) >= 3 -> blocking`,
which it calls out as measuring "how much we know, not how dangerous the state is." Concretely:
three facts from one dimension no longer block, and three unrelated facts don't block unless
someone is exposed. That's ignition-triangle reasoning a safety engineer already uses, expressed
over detectable facts.

The ablation table is the proof it's a pathway model and not a checklist: removing the atmosphere
dimension costs 37.4% recall, ignition 22.9%, exposure 18.3%, control-failure 15.8% — each
dimension is load-bearing and none dominates.

**Grounded in:** `backend/app/risk/policy.py:9-26` (docstring rejecting fact-counting),
`:55-72` (`HAZARD_DIMENSIONS`), `:193-339` (`classify()`),
`backend/app/context/derived_facts.py:597-614` (registry; 17 `rule_*` in the file),
`docs/eval-report.md:90-93` (ablations)

<a id="a3"></a>
## A3. How can I trust one agent?

**It isn't one agent — and no agent, singular or plural, ever sets the risk level.**

`build_graph()` wires 8–9 nodes: four source agents (scada, permit, maintenance, workforce), plus
spatial, predictive-trend, shift-handover, incident-pattern, and the orchestrator — fanned out
*selectively* by deterministic routing, so a nominal asset never wakes the fleet. All of them
produce facts and observations only. Those feed one deterministic function, `classify()`, which is
the sole place a verdict is computed, and it runs before any LLM step. A separate guard strips
any citation in the generated summary that wasn't actually retrieved, before a human sees it.

**Grounded in:** `backend/app/agents/graph.py:86-127`, `backend/app/agents/routing.py:10,31-50,89-98,101-116,119-122,125-135`,
`backend/app/risk/policy.py:1-7,193-339`, `backend/app/agents/nodes/orchestrator.py:23-27,420-421,455-457,481-486`,
`backend/app/assessment/citations.py:66-96,196-214`

<a id="a4"></a>
## A4. Why LangGraph? Isn't a multi-agent framework overkill for this?

**Because fan-out is conditional, and the graph is what makes "which specialists ran, and why"
inspectable and streamable rather than buried in an if-tree.**

Routing gates each agent on matching facts or context categories — spatial only on
elevated/gas/hot-work signals, predictive-trend only when the focus asset has telemetry,
shift-handover only when this asset carried unacknowledged items, incident-pattern only once the
verdict is already elevated or blocking. Every step streams to the UI Brain panel as an
`agent.step` event, which is what a supervisor actually audits. The whole run is bounded by a
45-second graph-level timeout.

**Grounded in:** `backend/app/agents/routing.py:31-50,89-98,101-116,119-122`,
`backend/app/agents/graph.py:86-127`, `:235-238,264-267` (timeout),
`backend/app/core/config.py:125`

<a id="a5"></a>
## A5. What if the LLM hallucinates?

**Structurally it can only hallucinate prose, and even that is filtered — it cannot hallucinate a
verdict, because it never writes one.**

Three layers. First, `risk_level` is deterministic and computed before the model runs ([A1](#a1)).
Second, `check_citations()` extracts citation-shaped tokens from the generated summary and
compares them against the references actually retrieved; anything unsupported is stripped by
`strip_unsupported()` before persistence. Third, when the model returns empty or throws, narration
falls back to a deterministic template and the run is marked `degraded` rather than failing
silently — that flag is visible on AI Ops.

**Grounded in:** `backend/app/assessment/citations.py:66-96,196-214`,
`backend/app/agents/nodes/orchestrator.py:455-457`,
`backend/app/agents/nodes/source.py:115-159` (template fallback),
`backend/app/agents/llm_outcomes.py:43-59` (`degraded`)

<a id="a6"></a>
## A6. Sensor payloads flow into prompts — what about prompt injection?

**Honest answer: we have no dedicated prompt-injection defence, and we don't need one for the
verdict — but I won't claim the narration is hardened.**

The reason the blast radius is small: an injected string cannot change `risk_level`, because the
verdict is computed by deterministic Python from typed fact objects before any prompt is built,
and the citation guard strips fabricated authorities from the output. So the worst realistic
outcome is misleading prose next to a correct verdict and correct citations. That is a real
weakness and I'd rather name it than pretend we sanitize inputs. Closing it properly means
payload sanitization at the ingest seam plus output structural validation — neither is built.

**Grounded in:** `backend/app/risk/policy.py:193-339` (verdict from typed facts, pre-prompt),
`backend/app/assessment/citations.py:66-96` — **no input-sanitization layer exists; verified gap**

<a id="a7"></a>
## A7. Why deterministic rules instead of a learned model?

**Because a learned detector can't be audited against a statute, and this decision has to survive
an inspector — but we did build the ML comparison, and we publish where it loses.**

The compound engine is deterministic so every fired fact traces to a named rule and a citable
clause. We also run an OLS trend-forecast detector as a third arm in the eval, precisely so the
comparison is honest rather than rhetorical: forecast scores 66.4% accuracy / 31.6% FN, against
the compound engine's 98.0% / 0.0%. The forecast arm earns its keep on *lead time*, not accuracy —
it's what fires at t+6 in the Vizag timeline.

**Grounded in:** `backend/app/eval/detectors.py:46-81` (`forecast_alarm`),
`backend/app/agents/nodes/predictive_trend.py`, `docs/eval-report.md:29-31` (three-arm table),
`:61` (lead time)

<a id="a8"></a>
## A8. Where did the four hazard dimensions come from?

**From the ignition-triangle reasoning a process-safety engineer already uses, restricted to what
we can actually detect — not from a model we fit.**

Atmosphere (a hazardous substance), ignition/energy (something that can initiate it),
control-failure (the barrier meant to keep them apart has failed), and exposure (people in the
affected space). The policy docstring states the derivation directly. The statutory backing is
what makes it defensible rather than plausible: Factories Act 1948 s.37(1)(c) requires "exclusion
or effective enclosure of all possible sources of ignition" — the compound thesis is already in
Indian statute; we made the plant able to notice it.

**Grounded in:** `backend/app/risk/policy.py:9-26,55-72`,
`backend/app/db/seed_embeddings.py:117-128` (s.37(1) with clause + source URL),
`docs/eval-report.md:90-93` (each dimension measurably load-bearing)

<a id="a9"></a>
## A9. Who can change the thresholds, and is that audited?

**Today: anyone who can reach the API, and no — it is neither authenticated nor audited. That's a
real gap and the fix is small.**

`PUT /api/config/thresholds` patches thresholds in-process (env override + settings-cache clear)
and genuinely affects subsequent derived-fact evaluation. It carries no `Depends` actor check and
makes no `record_audit` call — the only endpoint we found that changes behaviour with neither.
Mitigating context, offered honestly rather than as cover: it's scoped to the running process and
never rewrites `.env`, the UI labels it "editable for this runtime session," and there is one real
guard — `critical <= elevated` is rejected. In production this sits behind the same actor check
and audit call as every other write; that's one decorator and one line.

**Grounded in:** `backend/app/config/routes.py:17-25` (no auth dependency, no audit),
`backend/app/config/service.py:66-80` (env patch + cache clear), `:80` (critical>elevated guard),
`frontend/components/nav/SettingsMenu.tsx:83-94`

---

# B · Evidence & rigor

<a id="b1"></a>
## B1. Is any of this real data?

**The regulatory corpus is real and clause-level with primary-source URLs. The plant telemetry is
simulated, and we label it.**

Five statutory entries — Factories Act 1948 s.37(1), s.36(2), s.41H, s.41B, and OISD-STD-105 —
each carrying a specific `clause` field and a `source_url` pointing at the actual statute text on
Indian Kanoon, not a summary page. A summary can only cite what was actually retrieved; the rest
is stripped. What's synthetic: five scripted YAML scenarios, a randomized combinatorial engine,
and always-on ambient telemetry — all landing on the same `ingest_context` seam a real SCADA/PTW
integration would use.

**Two honest caveats.** The synthetic-data disclosure appears at the landing and login pages, but
the in-app badge a CSS comment refers to does not exist — inside the running twin there is no
"this is simulated" label. And the clause *wording* was transcribed from Indian Kanoon rather than
the Gazette; our own audit flags that as deserving a domain check.

**Grounded in:** `backend/app/db/seed_embeddings.py:114-182,197-200`,
`backend/app/assessment/citations.py:66-96,196-214`,
`backend/app/simulator/random_engine.py:1`, `backend/app/simulator/ambient.py:1-7`,
`frontend/components/landing/LandingFooter.tsx:43`, `frontend/app/login/page.tsx:151`,
`docs/audit-2026-07.md:446-449` (Gazette caveat) — gap: no badge in `nav/AppShell.tsx`/`TopNav.tsx`

<a id="b2"></a>
## B2. What's your false-alarm rate? ⚠

**Straight answer: we don't publish a false-positive *rate*. We publish the raw count — 12 false
alarms across 200 safe cases — and 97.0% precision. I'd rather give you that than a number we
didn't compute.**

`DetectorMetrics` computes accuracy, recall, false-*negative* rate and precision; there is no FPR
property in the code, and the eval report quotes the count, not a percentage. What the 12 are:
the engine is deliberately more conservative than the statutory minimum — hot work plus unverified
isolation plus personnel present, at a clean gas reading. The report calls that "a defensible bias,
not a defect," and we'd defend it: the asymmetry between a missed stop-work case and a
conservative hold is not close.

The second half of the answer, which matters more operationally: a 4-tier response engine bounds
what *any* alarm can do. Every autonomous action passes a four-clause gate — reversible, moves the
device toward its protective state, blast radius bounded to the affected zone, and tier ≤ 2. All
four must pass. Tier 3 (shutdown, depressurization) fails in code, not by convention. So a false
positive triggers a scoped reversible response, never an irreversible or plant-wide one.

**Grounded in:** `backend/app/eval/metrics.py:31-57` (no FPR property), `:96-97`,
`docs/eval-report.md:31` (97.0% precision), `:37-39` (12 FPs), `:51-54` (why),
`backend/app/response/envelope.py:10-23,48,202-207,233-309`,
`backend/app/response/service.py:69-99,105-114`

<a id="b3"></a>
## B3. How do you know the eval isn't circular?

**Because the labeler is structurally forbidden from importing the engine it scores, and a test
fails if they ever agree on everything.**

Ground truth derives from statutory stop-work criteria over raw context payloads — not from our
derived facts. Tests parse the module's AST and fail the build if it imports `app.risk.policy` or
calls `evaluate_rules`/`classify`/`compound_alarm`/`_fuse_risk`. A second test asserts the compound
detector and the labels **disagree somewhere**: perfect agreement is treated as the signature of
circularity, not as success. This replaced an earlier harness where "dangerous" was defined as
"the compound engine fired" — which made 0% false negatives true by construction and
unfalsifiable. We found that ourselves and fixed it.

**Grounded in:** `backend/app/eval/hazard_ground_truth.py:1-27`,
`backend/tests/test_eval_independence.py:1-10,22-23,37-43,46-60,63-77`,
`docs/eval-report.md:12-18`

<a id="b4"></a>
## B4. What does "28 minutes of lead time" actually mean?

**Plant process time between our compound alarm and the moment a single-sensor threshold would
finally fire — on one scenario, the Vizag one. It is not a claim about 28 minutes on every
incident.**

On `vsp_coke_oven`: compound and forecast both alarm at t+6; single-sensor critical is crossed at
t+34. The clock is each step's `t_offset_minutes`, i.e. modeled process time — explicitly not
simulator playback pacing. Be precise about scope, because the report is: lead time is defined
only where a timeline crosses the critical line *after* the compound alarm, so of five scenarios
only one has a defined figure. "Min 28 · median 28 · max 28" is one scenario, not a distribution.
Say "on our Vizag reconstruction," never "typically."

**Grounded in:** `docs/eval-report.md:61` (the number), `:58-59` (process-time clock),
`:65-69` (definition and exclusions), `:73-79` (per-scenario, spread over n=1),
`backend/app/eval/lead_time.py`

<a id="b5"></a>
## B5. Where did the 593 cases come from?

**A parameter sweep plus the scripted scenario timelines — generated, and we say so.**

593 cases: 393 requiring stop-work (66%), 200 safe (34%). Generated by sweeping atmosphere level
and trajectory, permit and isolation state, concurrent operations, personnel presence and process
temperature, plus the scenario timelines. The framing the report insists on, and we should repeat
before being asked: this is **criterion coverage**, not a claim about generalizing to unseen
real-world incidents. The meaningful comparison is the single-sensor baseline scored on the *same*
labels — and it misses 175 of 393.

**Grounded in:** `docs/eval-report.md:20-23` (dataset + generation), `:43-48` (framing),
`:50-51` (explicit anti-overclaim), `backend/app/eval/dataset.py`

<a id="b6"></a>
## B6. Your geospatial work — why isn't it in the metrics?

**Deliberately excluded, to avoid exactly the circular labeling we removed elsewhere. Volunteer
this before it's found.**

The knowledge graph is real — networkx over Euclidean adjacency from the floor plan — and spatial
neighbours are genuine evidence for the supervisor. But `eval/detectors.py` passes no observations,
so spatial never touches a reported metric. Making it one honestly requires a distance-based
criterion in the ground truth *first*; adding cross-asset cases without that would reintroduce the
circularity we just eliminated. Also note the eval harness is DB-free and same-asset cases have
distance 0.0 m — a tautology, not a signal. Positioned as evidence, not accuracy.

**Grounded in:** `backend/app/eval/detectors.py` (no observations passed),
`backend/app/graph/kg.py`, `backend/app/agents/nodes/spatial.py`,
`docs/pitch-scorecard.md:189-218` (the three reasons, third is the real one),
`docs/comprehensive-guide.md:271-280`

<a id="b7"></a>
## B7. Is this actually RAG?

**Partly — and the regulatory path deliberately isn't. Don't let us be described as RAG-for-
compliance, because that's not what we built.**

Retrieval tries pgvector first, applies a quality gate, then falls back to deterministic SQL. Two
facts to state plainly: `RAG_VECTOR_SOURCE_TYPES` is **incidents-only**, so regulations and SOPs
are never vector-searched in any configuration; and with the default mock embedding provider (a
hash-derived vector) the quality gate never passes, so the deterministic path always wins. That's
a deliberate trade for guaranteed citation coverage — 100% of cases with a derived fact have a
citable regulation. Vector retrieval is used for incident precedent, where similarity is the right
tool.

**Grounded in:** `backend/app/assessment/retrieval/__init__.py:151-165` (timeout + fallback),
`backend/app/assessment/retrieval/deterministic.py:15`,
`backend/app/core/config.py:114`, `docs/eval-report.md:100-102` (100% citable / 91.7% Indian
statutory), `docs/comprehensive-guide.md:179,434`

---

# C · Deployment & scale

<a id="c1"></a>
## C1. Your product assumes an instrumented plant — what about everyone else?

**It doesn't require instrumentation. A permit officer can type the context in and get the same
assessment.**

`POST /context` accepts a manually-entered payload and routes it through the identical
facts → review → assessment pipeline a SCADA feed uses. And when there's no pipeline output at
all, a supervisor can author a manual assessment by hand, which supersedes any in-flight AI job so
a late-finishing worker can't corrupt the state machine. The premise we'd actually push back on is
that plants are under-instrumented — most MAH-class plants have gas detection, PTW and a CMMS
already. What they don't have is anything reading all three in the same sentence.

**Grounded in:** `backend/app/context/routes.py:24-33`,
`backend/app/assessment/manual.py:1,23-34,49-65`, `backend/app/reviews/routes.py:413-430`,
`docs/archive/PRD.md:52-54` (the "not under-instrumented" argument)

<a id="c2"></a>
## C2. What happens when a sensor is down?

**Blind is not safe — and that's a product feature you should let me show you rather than
describe.** *(Demo this live on the twin.)*

`context/coverage.py` classifies every asset `assessed | degraded | blind`. No reading ever
arrived, or the last reading is older than the staleness threshold → `blind`, with a reason string
that says "absence of data, not safety." A self-reported fault or low-confidence reading →
`degraded`, naming the fault. Staleness is computed over **both** telemetry tables, because a rule
cannot observe silence and neither table alone sees the whole feed. Seeded mock rows are excluded
so `assessed` can't be earned by a fake reading.

Critically it is **orthogonal to risk** — never a fourth risk level, never changes a verdict. And
it's visible on the hero surface: a dashed coverage ring plus a struck-through slash on the asset
marker — deliberately not another colour, so it reads as "no signal" rather than as an alarm state.

**Grounded in:** `backend/app/context/coverage.py:1-22,49-71,74-106,109-174,177-216`,
`backend/app/context/routes.py:43-60`, `backend/app/context/schemas.py:51`,
`frontend/components/twin/DigitalTwin.tsx:26-27,196-211,658`,
`frontend/components/twin/FloorPlan.tsx:614-643`,
`frontend/components/twin/AssetMarker.tsx:58,77-98`

<a id="c3"></a>
## C3. How long would this take to deploy at a real plant?

**We don't have a validated number, and I won't invent one. What I can tell you precisely is the
integration surface, because it's deliberately small.**

Everything enters through one seam. The webhook adapter takes a JSON post from a SCADA historian —
source system, asset, readings — and lands on the same path scenarios and manual entry use. So the
integration work is: map historian tags to assets, map the PTW system's permit records, and map the
CMMS work-order state. Three adapters against one contract, not a platform migration. The product
sits *above* SCADA/DCS/SAP PM/Maximo/PTW rather than replacing any of them.

What we have not done is run that against a real historian, so treat the estimate as
architecture, not experience.

**Grounded in:** `backend/app/context/ingest_routes.py:20-49` (webhook contract + curl example),
`docs/architecture-ingest.md`, `docs/archive/PRD.md:11` (sits-above positioning)
— **no validated deployment timeline exists; see [G4](#g4)**

<a id="c4"></a>
## C4. Does this scale?

**The scaling design is real and load-bearing, and it's built on Postgres rather than more
services. What I don't have is a throughput benchmark.**

Assessments are a durable Postgres queue. Workers claim with `FOR UPDATE SKIP LOCKED`, so N
workers never double-run a job; an in-memory `asyncio.Queue` provides the low-latency wake path;
`recover_pending()` resets stranded `generating` rows at boot; and a lease sweep returns jobs
whose worker died mid-run. "Never double-run" is enforced at the database, not just in the claim
query — a unique partial index on `(review_id) WHERE status IN ('pending','generating')`.
WebSocket fan-out can't be stalled by a slow client: each connection has its own bounded 256-frame
queue and writer task, `broadcast()` never awaits a socket, and a wedged tab drops its oldest
frames rather than blocking ingest.

**Say the gap:** there is no load test, no jobs-per-minute figure. Capacity today is arithmetic
(workers × measured per-assessment latency), not a measurement.

**Grounded in:** `backend/app/assessment/orchestrator.py:23-29,205-222` (`SKIP LOCKED` at :216),
`:79-147` (`recover_pending`), `:176-203` (lease), `backend/app/db/schema.sql:371-376` (unique
partial index), `backend/app/realtime/connection_manager.py:12,33-48,79-92,94-108`,
`backend/app/core/config.py:41-46` — **no throughput benchmark exists in the repo**

<a id="c5"></a>
## C5. Can it run multiple plants?

**No — it's single-plant today, and that was a deliberate scoping call rather than an oversight.**

There is no tenant scoping: `plant_id` exists on `assets` only, and is never used as a query
filter; the WebSocket manager's own docstring says "single tenant / plant." The honest framing is
that the *seam* exists — every review and assessment reaches an asset, so scoping is a column and a
predicate, not a data-model rewrite. And the archived PRD names cross-plant benchmarking as an
explicit non-goal: it "requires a data-sharing and governance model not yet earned with a
single-plant pilot." I'd rather defend that reasoning than pretend the capability is there.

**Grounded in:** `backend/app/realtime/connection_manager.py:35` (docstring),
`backend/app/db/schema.sql:17` (`plant_id` on `assets` only, never filtered),
`docs/archive/PRD.md:298` (deliberate non-goal)

<a id="c6"></a>
## C6. What are your latency numbers?

**Measured, published, and I'll give you the caveat before you ask: they're agent latency, not
end-to-end.**

From `docs/model-bench.md` (6 cases × 2 repeats per provider): mock p50 15 ms / p95 40 ms;
`gpt-4o-mini` p50 5,196 ms / p95 6,094 ms at $0.000255 per assessment, 0% failures; local
`phi3:mini` p50 39.3 s / p95 74.0 s with a 41.7% failure rate — which is why local small models
aren't the default. The bench doc itself states these exclude retrieval, DB persistence and queue
time, so they are **not** "time to a verdict on screen." Live instrumentation on `/ai-ops` tracks
p50/p95 over a 500-sample window, tokens, and cost — and returns "—" rather than 0.0 on an empty
sample, deliberately.

**Two gaps:** the 400 assessments/day figure in that doc is labelled arithmetic, not a measurement
— don't quote it as capacity. And the WS backpressure counters exist in the API but are never
rendered in the UI, so showing dropped frames is a `curl`, not a tile.

**Grounded in:** `docs/model-bench.md:12-16` (numbers), `:21` (the exclusion caveat), `:46,49,59-66`
(projection labelled), `backend/app/core/stats.py:19-48`, `backend/app/ai_ops/service.py:23-24,296-311`,
`backend/app/ai_ops/schemas.py:75-90`, `backend/app/ai_ops/routes.py:104-114` — **`ws_*` counters
absent from `frontend/lib/liveApi.ts`**

<a id="c7"></a>
## C7. What happens if Postgres goes down?

**The API stays up, the queue survives, and jobs resume — the failure is designed for rather than
assumed away.**

Schema application and seeding are wrapped in a soft-fail at boot: the API boots even when
Postgres is unreachable. The worker pool starts regardless, because each job opens its own session
and the loop swallows per-job exceptions, so a transient outage at boot doesn't permanently strand
the queue. `pool_pre_ping=True` handles stale connections. On recovery, `recover_pending()` and the
lease sweep return stranded rows to `pending`. Pool is 20 + 10 overflow, sized explicitly because
one assessment holds a connection for its whole agent run.

**Gap worth naming:** no `pool_timeout` or `pool_recycle` is configured, so checkout starvation
falls back to SQLAlchemy's 30-second default rather than a considered value.

**Grounded in:** `backend/app/main.py:24-46` (soft fail), `:48-52` (workers start regardless),
`backend/app/db/session.py:14-26`, `backend/app/core/config.py:48-49`,
`backend/app/assessment/orchestrator.py:79-147,176-203`

<a id="c8"></a>
## C8. What if the LLM provider is down or slow?

**It degrades to deterministic narration rather than failing, and a hard failure is visible with a
human path out — but there's no circuit breaker.**

Layered: a 20-second per-call timeout on the OpenAI-compatible client, a 45-second whole-graph
timeout, template fallback on empty response or exception (flagged `degraded`), provider
auto-selection that probes ollama → openai_compatible → mock, and RAG failure falling back to
deterministic SQL after 3 seconds. If generation still fails, it fails **visibly**: the row goes to
`failed` with the error, the owner is notified, an `assessment.failed` event broadcasts, and the UI
offers "Retry AI" or "Create Manual Assessment."

**Two honest caveats:** there is no circuit breaker — a dead provider is re-probed every job,
nothing trips open after N failures. And the Ollama branch passes no per-call timeout, so the
45-second graph bound is the only limit there.

**Grounded in:** `backend/app/core/config.py:40,114,125,126`, `backend/app/agents/llm.py:36,47-48`
(and `:53-58` — no Ollama timeout), `backend/app/agents/graph.py:235-238,264-267`,
`backend/app/agents/nodes/source.py:115-159`, `backend/app/assessment/pipeline.py:647-733`,
`backend/app/assessment/provider_state.py:142-148`,
`frontend/components/assessment/AssessmentPanel.tsx:167-190` — **no circuit breaker (verified)**

<a id="c9"></a>
## C9. Why Postgres + pgvector instead of a real vector database?

**Because the retrieval path cites operational rows, and one datastore means those citations are
transactionally consistent with the records they point at — for the cost of a four-connection side
pool, not a second service.**

pgvector runs on a dedicated asyncpg pool (min 1, max 4) with an ivfflat cosine index. Note the
scope: vector search is used for incident precedent only — regulations and SOPs go through
deterministic SQL by design ([B7](#b7)) — so the "why not a vector DB" question has a much smaller
blast radius than it looks. The same one-datastore argument is why the assessment queue is
Postgres rather than Redis.

**Be precise about provenance:** the repo makes the no-Redis argument for the *queue* explicitly;
it contains no written justification for pgvector-over-a-dedicated-vector-DB. That's an argument
we're making, not one the code documents.

**Grounded in:** `backend/app/db/vector.py:1,27-30`, `backend/app/db/schema.sql:4,73-81,378-381`
(ivfflat), `docs/architecture-ingest.md:57` (no-Redis for the queue)

<a id="c10"></a>
## C10. You have no migration system — isn't that fragile?

**It's a hand-rolled forward-only one, and I'd call it that rather than claim we didn't need
migrations.**

`schema.sql` is idempotent — every table `CREATE TABLE IF NOT EXISTS`, every index likewise — and
is applied on every boot. Additive changes go into an explicit soft-migration block of
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and there's a data-repair-before-constraint pattern
(de-duplicate, then create the unique index) with the reasoning written in the file.

The real limitations, stated: no version table, no down migrations, and no failure isolation —
the file is applied as one unit, so a failing statement aborts everything after it on an existing
database. The file itself calls that out. For a hackathon build with no production data this is
the right trade; for a plant it isn't, and Alembic is the answer.

**Grounded in:** `backend/app/db/schema.sql:1,311` (soft-migration block), `:494-512` (repair
pattern + the one-unit risk), `backend/app/db/session.py:63-70`, `backend/app/main.py:30`

<a id="c11"></a>
## C11. Can this run on-prem or air-gapped? Plants don't send data to a cloud.

**Yes — and that's the default posture, not a port. Out of the box nothing leaves the machine.**

Default `AI_PROVIDER=mock` makes zero network calls. For real narration there's an `ollama`
provider for a locally-hosted model, and a `local` embedding provider — so the full pipeline runs
with no external dependency. Stack is Postgres + pgvector and a Python API; there is no managed
service in the critical path. The honest caveat is the one from [C6](#c6): our local-model bench
showed `phi3:mini` at a 41.7% failure rate, so a serious air-gapped deployment needs a larger local
model than the one we benchmarked.

**Grounded in:** `backend/app/agents/llm.py:29-58` (mock/ollama branches),
`backend/app/core/config.py:33`, `backend/app/assessment/embeddings/`,
`docs/model-bench.md:12-16` (local-model failure rate)

---

# D · Legal, regulatory, liability

<a id="d1"></a>
## D1. Is this a safety-instrumented system? Is it SIL-rated? ⚠

**No — and we'd never claim it. This is an advisory decision-support layer that sits above the
safety systems, not on the safety-instrumented path.**

Nothing here replaces a SIL-rated interlock, an emergency shutdown system, or a trip. Those are
independent protection layers with their own certification, and they must remain so — if our
service is down, every existing safeguard behaves exactly as it does today, because we're not in
that loop. What we add is the layer *above*: correlating signals that individually stay below
every trip threshold, and driving that to a recorded human decision. The design reflects this —
the AI recommends and the human's decision is the binding act, and even our autonomous responses
refuse anything irreversible or plant-wide ([B2](#b2)).

**Say this plainly:** there is no IEC 61508/61511 assessment, no SIL rating, and no functional-
safety certification. Getting there is a certification programme, not a feature.

**Grounded in:** `backend/app/response/envelope.py:10-23,233-309` (never-automatic tier),
`backend/app/agents/nodes/investigation.py:148` (`advisory only — never escalates the verdict`),
`docs/comprehensive-guide.md:378-387` (not-building list)
— **verified: zero references to IEC 61508/61511/SIL/safety-instrumented-system anywhere in the repo**

<a id="d2"></a>
## D2. Who's liable when it gets it wrong?

**The supervisor's decision is the binding act, and the system is built so that stays true — the
AI never decides, and we can prove who decided what, when, and on what evidence.**

Structurally: the platform assesses and recommends; a named human records the decision. Every
decision persists the deciding actor, outcome, conditions, and a **frozen snapshot of the evidence
content** — not just row IDs, precisely because a later edit to a context row would otherwise
silently change what a recorded decision appeared to rest on. Two audit entries are written
(`decision.submitted`, `evidence.captured`) into a hash-chained log. Time-to-decision is stamped
into the permanent packet.

The genuinely hard part — apportioning liability between a plant operator and a software vendor
when an advisory system contributes to an outcome — is a contractual and regulatory question we
have not solved, and I'd rather say that than give you a confident answer we haven't earned.

**Grounded in:** `backend/app/decisions/service.py:238-265` (what's recorded),
`:285-336` (evidence freezing; comment at `:288-290`), `:338-364` (audit entries),
`backend/app/reports/packet.py:307,310` (`decided_by`, time-to-decision)

<a id="d3"></a>
## D3. Why don't you route to DGMS?

**Because DGMS has no jurisdiction over a steel-plant coke oven — that's the Factories Act
inspectorate — and an earlier version of this product cited a DGMS circular that doesn't exist. We
found it in our own audit and removed it.**

The fabricated citation was `DGMS Circular 2017` — no number, no series. The audit dropped it and
replaced it with verified Factories Act 1948 clauses (s.37(1), s.36(2), s.41H) that actually apply.
Separately and more broadly: there is **no regulator-notification or escalation-routing feature in
the product at all**, to DGMS or anyone. The product ends at a recorded decision and a frozen
packet, not an automated filing. The brief asks for a "preliminary regulatory-compliant incident
report" — we generate the evidence packet, not a filing.

**Grounded in:** `docs/audit-2026-07.md:107,110-111,237-241,261-262,281-282`

<a id="d4"></a>
## D4. Is the audit trail admissible? And why not blockchain?

**Same cryptographic property a chain gives you — append-only, order-fixed, tamper-evident — with
one advisory lock and a SHA-256 column. A blockchain buys consensus among mutually distrusting
parties; in one plant, the DBA and the auditor are on the same side. What they need is detection.**

Mechanism: each entry hashes `prev_hash ∥ entity ∥ event ∥ actor ∥ canonical_payload ∥ recorded_at`
with a US-separator delimiter that can't appear in the values, so field-boundary collisions are
impossible. Order comes from a `BIGSERIAL` `seq`, not timestamps, so clock skew can't reorder the
chain. Appends take a transaction-scoped advisory lock, so two concurrent writers can't read the
same tail and fork it. `GET /audit/verify` recomputes the whole chain and names the exact entry
that broke, distinguishing a broken link from altered content.

The subtle bit worth showing a technical judge: verification carries the **recomputed** hash
forward, not the stored one — otherwise a tampered entry could heal the chain behind itself.

**And the honest framing, which is already written in the file:** this does not *prevent*
tampering — a database owner can always rewrite rows — it makes tampering **detectable**, which is
what an auditor actually needs. On admissibility specifically: we have no legal opinion, and I
won't assert one.

**Grounded in:** `backend/app/audit/chain.py:6-13` (the honest positioning), `:16` (seq not
timestamps), `:27,35-47,50-77` (hash construction), `:30-32` (lock key),
`:118-182` (verification), `:171-176` (recomputed-hash-forward),
`backend/app/audit/service.py:35-39`, `backend/app/audit/routes.py:16-28`,
`backend/tests/test_audit_chain.py:48-140`

<a id="d5"></a>
## D5. You track worker location — what about privacy and union consent?

**Real question, and we don't have a built answer. There is no consent model, no anonymization,
and no retention policy in the code.**

What's true: `worker_location` payloads carry a `worker_id`, and the platform uses zone occupancy
as the exposure dimension — a person being in the affected space is what turns a hazardous
co-occurrence into a block. So the safety value is genuine and the privacy exposure is genuine.
Two things partially limit it by design rather than by accident: we deliberately did **not** build
CCTV or vision-based worker surveillance, which is on the explicit not-building list; and the
location signal is used as a zone-level hazard classification for a safety verdict, not as
productivity monitoring.

Closing this properly means role-based access to identity, aggregate-only display where identity
isn't needed, a retention window, and works-council consultation before deployment. None is built.

**Grounded in:** `backend/app/context/derived_facts.py:124,150,235` (`worker_location`, `worker_id`),
`backend/app/risk/policy.py:55-72` (exposure dimension),
`docs/comprehensive-guide.md:383` (CCTV surveillance deliberately not built)
— **verified: no privacy/consent/anonymization/retention code anywhere in `backend/app/`**

<a id="d6"></a>
## D6. What's your security posture?

**Demo-grade, and I'll name the specific holes rather than describe a posture we don't have.**

The ingest webhook — the adapter a real historian would post to — has no authentication dependency,
no rate limit and no idempotency key. Auth generally is a seeded actor cookie, not a real identity
provider. `PUT /api/config/thresholds` is neither authenticated nor audited ([A9](#a9)). For a
closed-network demo that's acceptable; for a plant it isn't, and the list of what's needed is
short and concrete: API key or mTLS on ingest, rate limiting, an idempotency key, a real IdP with
RBAC, and the standard actor+audit treatment on the config route.

**Grounded in:** `backend/app/context/ingest_routes.py:20-24` (no auth dependency),
`backend/app/config/routes.py:17-25`, `backend/app/auth/routes.py` (seeded cookie actor),
`docs/comprehensive-guide.md:391-395` (known-gaps list)

---

# E · Human factors & UX

<a id="e1"></a>
## E1. What stops a supervisor just clicking "approve" on everything? ⚠

**We have no anti-rubber-stamping heuristic, and I'd rather say so than invent one. What we have is
structural friction plus a permanent record — and the real fix is upstream: fewer alarms.**

Six things that are actually in the code:

1. **A blocking assessment cannot be approved at all** — enforced server-side with a 409, and the
   option is never rendered in the UI. This is the important one: the highest-stakes case removes
   the rubber stamp entirely.
2. **A human's floor concern can itself force a block** — `supervisor_safety_hazard` is a blocking
   fact in the policy, so a worker's report hard-gates the supervisor's options.
3. **No outcome is pre-selected**, so the form cannot be submitted by reflex, and there is no
   "approve all" affordance anywhere.
4. **Conditions are mandatory** for `approved_with_conditions`, validated in Pydantic and again in
   the service.
5. **Approving generates real work assigned to a named person** — the zone owner is always
   included and cannot be unchecked. A rubber stamp still lands on someone's task list.
6. **Time-to-decision is stamped into the frozen packet** next to `decided_by`. A three-second
   decision is visible in the permanent record forever. That's the closest thing we have to a
   rubber-stamp detector, and it's a record, not a nudge.

Then the upstream argument, which is the real one: alarm fatigue is caused by alarm volume, and
the whole compound thesis is to raise *fewer, better* alarms than a threshold system — and we
publish the confusion matrix rather than asserting it.

**Two things to concede if pushed** — every recommendation defaults to `accepted`, so a supervisor
who touches nothing accepts all of them; and there's an unaudited Do Not Disturb switch that mutes
badges and chimes globally. It never reaches the FSM or the blocking gate, but it's fair to call
it an alarm-fatigue hazard.

**Grounded in:** `backend/app/decisions/service.py:211-215` (blocking gate), `:231-235`,
`:389-411` (zone owner mandatory), `backend/app/reviews/concerns.py:38` +
`backend/app/risk/policy.py:242-245`, `backend/app/decisions/schemas.py:21-27`,
`frontend/components/decision/DecisionPanel.tsx:62-65,66,110-112,231,242`,
`:104-107` (accept-by-default caveat), `backend/app/reports/packet.py:307,310`,
`frontend/components/nav/SettingsMenu.tsx:63-81` (DND), `frontend/components/eval/CompoundScorecard.tsx:163`
— **verified: no approval-rate metric or per-supervisor decision statistics exist**

<a id="e2"></a>
## E2. What if the supervisor disagrees with the AI?

**They overrule it — that's the design, not an escape hatch. The only thing they can't do is
approve through a blocking verdict.**

The supervisor can reject any individual recommendation, and rejections are preserved into the
frozen report deliberately — the record of what was declined is evidence, not noise. They can
write a manual assessment that supersedes the AI's entirely. They can add a rationale that posts
to the review thread with @-mentions so the floor team sees the reasoning. And if the situation has
moved on, the UI flags a prior decision as superseded rather than letting it stand silently.

The one hard stop is the blocking gate ([E1](#e1)) — and that's deliberate: the system's own
verdict is not overridable by the individual under time pressure, which is exactly the failure mode
in most incident reports.

**Grounded in:** `backend/app/decisions/service.py:268-283` (per-rec disposition),
`backend/app/reports/packet.py:399-401` (refusals carried into the packet deliberately),
`backend/app/assessment/manual.py:23-34,49-65`,
`backend/app/decisions/service.py:163-178,421-436` (rationale → thread),
`frontend/components/decision/DecisionPanel.tsx:164-211,487-490,641-647`

<a id="e3"></a>
## E3. Why no vernacular UI?

**Genuine gap — there is no internationalization at all. Every string is hardcoded English.**

No `next-intl`, no `react-i18next`, no locale directory, no language switcher anywhere in the
frontend. This is worth naming as roadmap rather than defending: a plant floor in India runs on
more than English, and a real deployment needs at minimum Hindi plus the relevant state language
before this sits on a control-room wall. Structurally it's a string-extraction pass over the
component tree — real work, not architectural.

**Grounded in:** `frontend/package.json:14-34` (no i18n library),
`frontend/components/twin/DigitalTwin.tsx:680-681,720,781` (representative hardcoded strings)

<a id="e4"></a>
## E4. How much training does an operator need?

**There's a guided eleven-step tour built into the product that drives the real UI against the
real backend — not a slideshow.**

The Grand Tour is staged as an opera in eight acts: the plant map, conditions converging, the
specialist agents, the evidence radar and why-brief, the supervisor's verdict, the frozen packet,
shift handover, and the scorecard. It has two modes — auto performs the gesture for you,
interactive waits for you to actually do it. Act II replays the real `compound_risk` scenario
through the real backend; nothing is mocked unless the backend is unreachable, in which case it
flips to labelled fallback copy. First-visit prompt, Escape exits.

**Before demoing it, fix or skip Act IV** — the narration says "Six domains… a lopsided hexagon"
while the radar now renders seven wedges.

**Grounded in:** `frontend/lib/tourScript.ts:4-15,417,420-645`, `frontend/lib/tourStore.ts:18,20-37`,
`frontend/components/tour/TourOverlay.tsx:327-330`, `frontend/app/layout.tsx:105`
— **defect: `tourScript.ts:520,522` vs `frontend/lib/domains.ts:23-32` + `DomainRadar.tsx:38`**

<a id="e5"></a>
## E5. Is it accessible?

**We did the accessibility work that changes whether an operator can use it — and crucially, no
risk state is communicated by colour alone. Two real holes I'll name.**

What's there: a global `:focus-visible` ring, `prefers-reduced-motion` honoured globally plus in
fifteen component stylesheets, and proper ARIA on the decision surface — `role="radiogroup"` with
`aria-checked`, `aria-pressed` per recommendation, labels bound to the conditions textarea, and
correct handling of the hidden-but-present collapsed field. Real keyboard shortcuts on the twin:
arrows change floor, Escape deselects then exits, and keystrokes inside inputs are correctly
ignored.

The colour point is the one worth making: every risk badge carries an uppercase text label
alongside the colour; `halted` is distinguished by a dashed border and `critical` by a glow, not
just hue; and sensor blindness renders as a dashed ring plus a struck-through disk specifically so
it reads as "no signal" rather than as a fourth alarm colour. Marker `aria-label`s build a full
sentence including coverage state.

**The two holes:** map markers are `tabIndex={-1}`, so the hero surface's primary interactive
element is mouse-only — deliberate (focus-scroll fought the pan/zoom transform) but a genuine gap.
And there has been no WCAG contrast audit, no `prefers-contrast`/`forced-colors` support, no
skip-link, and no automated a11y test across the six themes.

**Grounded in:** `frontend/styles/base.css:9-13,58-65,80-128`,
`frontend/components/twin/AssetMarker.tsx:56` (the `tabIndex` hole), `:58,77-98`,
`frontend/components/decision/DecisionPanel.tsx:151-155,183-187,195,278,288-289,313-320,326-327`,
`frontend/components/twin/DigitalTwin.tsx:581-605`
— **verified: no WCAG/contrast/colourblind work anywhere in `frontend/`**

<a id="e6"></a>
## E6. Does it work on a phone or tablet? A supervisor isn't at a desk.

**Yes for triage and deciding — 172 media queries and two deliberate mobile patterns, not a
breakpoint sprinkle. The map is the part I wouldn't oversell.**

Below 640px the primary nav rewraps into two rows (there's a written design note explaining that
its rigid children gave it a 554px intrinsic floor that made every page scroll sideways), and the
review sidebar stops being a side rail and becomes a bottom sheet at 52vh with a slide-down
transition. Progressive disclosure above that hides identity at ≤1100px and the wordmark at
≤900px. Reports have three responsive tiers plus a print stylesheet.

**The honest limit:** pinch-zoom on the plant twin is deliberately disabled because it fought the
pan transform — zoom is via on-screen controls and double-tap. So a supervisor can triage, read the
why-brief and record a decision from a phone; the map itself is more comfortable on glass.

**Grounded in:** `frontend/components/nav/TopNav.module.css:182-227` (the design note),
`frontend/components/twin/ReviewSidebar.module.css:927-945` (bottom sheet),
`frontend/components/twin/MapViewport.tsx:348-355` (pinch disabled),
`frontend/components/reports/ReportDetailView.module.css:841,851,863`

<a id="e7"></a>
## E7. What does the shift-handover feature actually enforce?

**You cannot take custody of a shift while a required item is still unacknowledged. That refusal
is the whole feature.**

`accept()` refuses with an error naming the count of outstanding items — its docstring puts it
better than I can: "without it a handover is a document nobody has to read, which is the failure
the platform exists to catch." The carry-forward list auto-composes from open reviews, active
response actions, active hazard facts, open unblock tasks and decision conditions — with
`requires_ack` set by severity. Only the outgoing operator can issue, only the incoming can
acknowledge, and they must be different people. There's a genuine third acknowledgement state —
"queried" — so the incoming operator can push back rather than just tick.

Two details that make it more than a form: an abandoned handover is retired rather than blocking,
but its unacknowledged items **stay visible as gaps**, because an abandoned handover is itself a
handover failure. And an unacknowledged handover raises risk on a fresh review — it feeds the
policy, with a test to prove it.

**Grounded in:** `backend/app/handover/service.py:1-9,444-465` (the gate), `:200-212`,
`:240-279,345-346,401-402`, `:473-486` (audit), `backend/app/handover/composer.py:118-370`,
`backend/app/risk/policy.py:215`, `backend/tests/test_handover.py:118,183`,
`frontend/components/handover/HandoverView.tsx:213,348`

<a id="e8"></a>
## E8. Can someone close a review with follow-up work still open?

**Yes — and the UI names it rather than blocking it, because the platform doesn't own the plant
floor.**

If tasks are still open, the panel says so — "N follow-up tasks still open. You can still close,
but the floor team may not be done" — and the button relabels to "Close anyway." That's deliberate:
physical work happens outside the platform, so a hard block would just train people to route
around it. What *is* enforced: a blocked decision locks the asset until an unblock task completes,
and reopening a review cancels its open tasks with a broadcast per row.

**Grounded in:** `frontend/components/decision/DecisionPanel.tsx:560-565,583-585`,
`backend/app/decisions/service.py:416-419` (asset lock),
`backend/app/reviews/repository.py:292-299` + `backend/app/tasks/service.py:62-102` (reopen cancels),
`backend/tests/test_decisions.py:352`

---

# F · Business & viability

> All figures below are in `docs/business-impact-model.md`, which tags every number `[cited]` or
> `[modeled]` and carries a Sources block with live URLs. **That doc is currently orphaned —
> nothing in the repo links to it.** Worth fixing before finals: it's the strongest business
> artifact we have and a judge would never find it.

<a id="f1"></a>
## F1. What's the business model? What does it cost? ⚠

**Honest answer: we have a defensible value model and we do not have a pricing model. One is
worth a lot more than the other at this stage, and I won't pretend the second exists.**

What we have: a modeled cost of **under ₹1–2 crore per plant per year** all-in (software,
integration, ops), against a modeled ₹50 crore per prevented incident — so one prevented incident
pays for roughly 25–50 plant-years. The buyer and motion are scoped: Plant Ops / EHS leadership at
MAH-class facilities in steel, refining, petrochem and fertilizer, landing on one battery or unit,
expanding to the plant, then to the operator's fleet.

What we don't have, and I'd list it if asked: no pricing structure (per-plant vs per-asset vs
per-seat), no license-vs-SaaS decision, no unit economics or COGS — despite `/ai-ops` tracking
inference cost per assessment live, which is where those numbers would come from — no sales cycle
or procurement path, and no integration-cost breakdown.

**Grounded in:** `docs/business-impact-model.md:67` (cost line), `:68` (break-even),
`:96-103` (buyer, workflow, land-and-expand),
`backend/app/ai_ops/service.py:398-415` (live cost tracking — the seam for unit economics)

<a id="f2"></a>
## F2. Who actually buys this, and who champions it internally?

**Plant Operations and EHS leadership at major-accident-hazard facilities — and the champion is
whoever owns the permit-to-work process, because that's whose job this changes.**

The workflow change is concrete: a structured Operational Review before work authorization, instead
of a phone call between a control room and a permit desk. That's the FICCI finding we're selling
against. Land on one unit — a coke-oven battery — prove it on one shift pattern, expand to the
plant, then across the operator's fleet. Target verticals are steel, refining, petrochemicals and
fertilizer, because that's where the MAH-unit count and the compound-hazard profile both sit.

**Grounded in:** `docs/business-impact-model.md:96-103`, `:54` (the manual-handoff finding),
`:81` (MAH-unit universe)

<a id="f3"></a>
## F3. Where does the ₹50 crore figure come from?

**It's a modeled aggregate of four blocks, two of them anchored on cited public figures — and we
deliberately anchor below what our own build-up allows.**

The four blocks: human and compensation costs `[cited]` — VSP paid ₹1.72 crore per regular
employee and ₹45.75 lakh per contract worker, with ~8 fatalities, giving ₹6–14 crore; production
downtime `[modeled]` — 15–45 days at ₹1–3 crore/day; regulatory penalty `[cited]` against
comparables — Dahej NGT ₹25 crore, Sterlite ₹100 crore — provisioned conservatively at ₹10–25
crore; and asset, investigation, legal and reputational `[modeled]` at ₹10–30 crore.

That build-up supports ₹100–150 crore for a VSP-scale event with an extended outage. **We quote
₹50 crore precisely because it's below what our own model allows** — if we're wrong, we're wrong
in the conservative direction. Two of four blocks are our stated ranges with no external source,
and the doc labels them that way.

**Grounded in:** `docs/business-impact-model.md:27-31` (the four blocks with tags),
`:33-37`, `:107-115` (the anchoring reasoning), `:121-123` (sources: Deccan Herald,
Telangana Today, NGT and Sterlite comparables)

<a id="f4"></a>
## F4. Your 6,500 deaths and 60% figures — where are those from?

**Both come from the competition's own problem statement, attributed to DGFASLI and a 2024 FICCI
survey. We have no independent URL for either, and I'd flag that rather than imply we verified
them.**

The 6,500 figure is DGFASLI, FY2023, and the brief notes it excludes most mining and construction.
The 60% manual-handoff figure is FICCI 2024. Both are inherited from the organizers' framing — a
defensible chain of custody, but not a primary source.

**One nuance to have ready**, because a judge could catch it: our own business model carries a
*different* separately-sourced DGFASLI figure — roughly 1,109 registered-factory fatalities a year,
about three a day, with an IndiaSpend link. Those differ by denominator: registered-factory
fatalities versus broader industrial. If challenged, use 1,109 — it's the one with a URL.
(Also: the brief says "over 60%"; our landing page says a flat 60%.)

**Grounded in:** `docs/archive/problem statement.md:1` (both figures, as given),
`docs/business-impact-model.md:82` (1,109, with URL at `:125`), `:83-84`, `:126` (chain of custody),
`frontend/components/landing/GapSection.tsx:12-22`

<a id="f5"></a>
## F5. How big is the market?

**1,861 major-accident-hazard units in India — that's the number with a real institutional source
behind it, NDMA, with a link. And we deliberately don't turn it into a revenue forecast.**

Every one of those facilities already has the data in separate systems today; the addressable
value framing is that universe against ₹50 crore of avoided incident cost. Our own doc is explicit
that this is an order-of-magnitude addressable-value statement, **not** a TAM model and not a
revenue projection. If you want a TAM/SAM/SOM I'd have to build it — we haven't, and I'd rather
tell you that than sketch one on stage.

**Grounded in:** `docs/business-impact-model.md:81` (1,861, `[cited]` NDMA), `:124`
(https://ndma.gov.in/Man-made-Hazards/Chemical), `:87-91` (explicitly not a revenue forecast)

<a id="f6"></a>
## F6. Why hasn't Honeywell or AVEVA built this? What about existing PTW software? ⚠

**Because each incumbent owns one silo and is authoritative inside it — the gap is between them,
and nobody owns the gap. That said, I should be straight: we have no competitive analysis
artifact, and that's a real hole in our materials.**

The categorical argument is sound and it's what the landing page makes: gas detection says normal,
permit-to-work says valid, maintenance says in-progress, workforce says present — four systems,
four correct answers, no alarm. Compound risk is invisible to every one of them because it lives in
the correlation, and integrating a competitor's telemetry to alarm on it isn't a feature any of
them is incentivised to build. The archived PRD states the positioning directly: unlike standalone
PTW software, SCADA alarms, or manual cross-checks, each sees only one slice.

**What I won't claim:** we haven't benchmarked against a named product, we have no comparison
matrix, and there is no incumbent named anywhere in our repo. The honest version is "here's the
structural argument, and we haven't done the competitive homework yet."

**Grounded in:** `frontend/components/landing/GapSection.tsx:25-30` (four silos, "No alarm"),
`docs/archive/PRD.md:64` (positioning statement), `:11,52-54`
— **verified: zero references to any named commercial competitor anywhere in the repo**

<a id="f7"></a>
## F7. What's the moat? Couldn't someone rebuild this in a month?

**The demo, yes. The defensible parts are the hazard-pathway model with statutory grounding, and
the evaluation harness that proves it — and the harness is genuinely hard to fake.**

Three layers. The **pathway model** ([A2](#a2), [A8](#a8)) encodes process-safety reasoning tied to
named Indian statutory clauses with primary-source URLs and validated citations — that's domain
work, not engineering work. The **eval harness** is the one competitors and demos consistently
lack: independent ground truth that's structurally forbidden from importing the engine it scores,
with tests that fail if the labels ever agree perfectly. Anyone can claim compound detection; very
few can show a confusion matrix against labels they can't have rigged. And **accumulating
operating history** — the corpus of decisions, conditions and cited authorities per plant — is a
data asset that compounds and doesn't transfer.

Say the honest half too: none of that is a patent or a network effect, and integration lock-in
would be the practical moat in the field.

**Grounded in:** `backend/app/risk/policy.py:55-72,193-339`,
`backend/app/db/seed_embeddings.py:114-182`, `backend/app/eval/hazard_ground_truth.py:1-27`,
`backend/tests/test_eval_independence.py:37-77`, `backend/app/history/service.py:27-43`

---

# G · Project honesty

<a id="g1"></a>
## G1. Where did the "discovered patterns" come from?

**Nothing is auto-discovered — we scoped ranked candidate-rule mining and deliberately didn't
build it. Patterns come from the hazard-pathway model, and historical precedent comes from
retrieval that's labelled when it's a fallback.**

To correct the premise directly: there's no pattern-mining feature and no pattern-mining UI
anywhere in the product. The compound "patterns" are the dimension model — atmosphere plus ignition
plus control-failure co-occurring is a pathway, computed deterministically. For historical incident
precedent there's a dedicated agent: when vector or SQL retrieval returns real historical rows,
those are used and cited. Its offline fallback content is hardcoded and **deliberately carries no
similarity score**, specifically so a fallback note can never be mistaken for a real vector match
with a confidence number attached.

**Grounded in:** `docs/finals/brief-coverage.md:12` ("deliberately not built"),
`backend/app/risk/policy.py:55-72,193-339`,
`backend/app/agents/nodes/incident_pattern.py:1,9-49,51-56`

<a id="g2"></a>
## G2. What did you deliberately not build?

**Long list, and volunteering it is the point.**

Not built, by choice: CCTV and vision-based worker surveillance; a plant-wide risk score or
traffic-light dashboard; auto-approval below a confidence threshold; a general-purpose safety
chatbot; a live 3D twin or continuous geospatial heatmap; anything replacing SAP, Maximo or SCADA;
a dedicated permit-intelligence *agent* (permit facts live in the general rule engine); a
quality-and-compliance audit agent; automated pattern discovery ([G1](#g1)); a regulator-
notification or escalation chain ([D3](#d3)); and cross-plant benchmarking ([C5](#c5)).

Known gaps rather than choices: no i18n ([E3](#e3)), unauthenticated webhook and threshold route
([D6](#d6), [A9](#a9)), no false-positive rate ([B2](#b2)), no throughput benchmark ([C4](#c4)),
no circuit breaker ([C8](#c8)), no operator validation ([G4](#g4)).

**One to never show:** `docs/finals/response-directory.md` contains fictional contact numbers and
describes an escalation chain that is **not implemented**. Don't display or imply it.

**Grounded in:** `docs/comprehensive-guide.md:378-387` (not-building list), `:391-395` (known gaps),
`docs/finals/brief-coverage.md:10-15`, `docs/finals/response-directory.md:4`

<a id="g3"></a>
## G3. How much of the brief did you actually cover? ⚠

**Four of six substantially, one partially, one not at all — and I want to be careful about one of
the four.**

Compound Risk Detection Engine: **fully covered**. Emergency Response Orchestrator: covered as
*bounded* autonomy — 4-tier registry, 4-clause reversibility gate, persisted refusals. Geospatial
Safety Heatmap: **partial** — real spatial graph and evidence, but no continuous gradient, and
deliberately not a scored metric ([B6](#b6)). Incident Pattern Intelligence: **partial** —
retrieval yes, automated discovery no. Digital Permit Intelligence: **partial** — permit facts are
real and OISD-cited but live in the general rule engine, not a dedicated agent. Quality &
Compliance Audit Agent: **not built**.

**The one to be careful with:** our own coverage doc marks the Emergency Response Orchestrator
"fully covered," but the brief asks for evacuation initiation, multi-channel response-team
alerting, and an auto-generated regulatory-compliant incident report — and our escalation chain is
not implemented and we generate an evidence packet, not a filing. The defensible framing is that
we built something *better-bounded* than the brief asked for — an agent that refuses Tier 3 and
shows you which clause stopped it — but it is not literally what the bullet requests. Say that
before a judge does.

**Grounded in:** `docs/finals/brief-coverage.md:10-15,21-25`,
`docs/archive/problem statement.md:1` (the six bullets),
`docs/finals/response-directory.md:4` (escalation chain not implemented),
`backend/app/response/envelope.py:202-207,233-309`

<a id="g4"></a>
## G4. Have you validated this with real plant operators? ⚠

**No. No plant visits, no operator interviews, no pilot, no domain-expert review of the rules.**

That's the honest answer and there's no version of it that sounds better. What the design *is*
grounded in: the published investigation findings from the Visakhapatnam incident, the statutory
text itself (Factories Act 1948 and OISD-STD-105, cited at clause level with primary sources), and
the organizers' problem statement. Our own internal audit flags a related gap — the clause wording
was transcribed from Indian Kanoon rather than the Gazette and deserves a domain check.

The first thing we'd do with a pilot is exactly this: put the seventeen rules and the four
dimensions in front of a working plant-safety officer and find out which ones are wrong. I'd
expect several to be.

**Grounded in:** `docs/audit-2026-07.md:446-449` (our own unverified-claims list),
`backend/app/db/seed_embeddings.py:114-182` (statutory grounding)
— **verified: no user-research, interview, or pilot artifact anywhere in the repo**

<a id="g5"></a>
## G5. Is this a demo or a real product?

**It's a working system with demo-grade edges, and I'd rather show you where the line is than
blur it.**

Real: the pipeline, the FSM, the deterministic risk engine, the durable queue with lease recovery,
the hash-chained audit log, the frozen report packets with PDF and Excel export, the handover
custody gate, the eval harness, and a genuine webhook adapter. The simulator posts to the *same*
ingest seam a real historian would — it isn't a mock layer bolted on the side, which is why
swapping in a real feed is an adapter rather than a rewrite.

Demo-grade: no auth on ingest or the threshold route, single-plant, no migration versioning, no
load testing, seeded actor cookies instead of an IdP, and a simulated plant. None of those is
architectural — they're the work between a finals build and a pilot.

**Grounded in:** `backend/app/context/ingest_routes.py:20-49` (same seam),
`backend/app/assessment/orchestrator.py:23-29`, `backend/app/audit/chain.py:6-13`,
`backend/app/reports/service.py:1-16`, `docs/comprehensive-guide.md:391-395`

<a id="g6"></a>
## G6. What's next?

**In order: validate the rules with a real safety officer, then close the two credibility gaps,
then pilot.**

Near-term and concrete: a false-positive rate in the scorecard ([B2](#b2)); auth, rate limiting and
an idempotency key on ingest, plus actor+audit on the threshold route ([D6](#d6)); Hindi and one
state language ([E3](#e3)); and a load test so capacity is measured rather than arithmetic
([C4](#c4)).

Then the ones that need a pilot to earn: distance-based spatial ground truth so geospatial becomes
a scored input honestly ([B6](#b6)); ranked candidate-rule mining so the rule set learns from the
accumulated corpus ([G1](#g1)); multi-plant scoping ([C5](#c5)); and the compliance-audit agent the
brief asked for ([G3](#g3)).

**Grounded in:** `docs/comprehensive-guide.md:271-280` (spatial next step, with the honesty
caveat), `docs/finals/brief-coverage.md:12,15`, `docs/todo.md`

---

## Appendix: numbers to get exactly right

| Claim | Correct value | Source |
| --- | --- | --- |
| Derived-fact rules | **17** (several docs still say 16 — safest is "a rule engine") | `backend/app/context/derived_facts.py` |
| Eval dataset | **593** cases — 393 stop-work, 200 safe | `docs/eval-report.md:20` |
| Single-sensor baseline | 70.5% acc · 55.5% recall · **44.5% FN** · 100% precision | `docs/eval-report.md:29` |
| Compound engine | 98.0% acc · 100% recall · **0.0% FN** · 97.0% precision | `docs/eval-report.md:31` |
| Missed stop-work cases, baseline | **175 of 393** | `docs/eval-report.md:37-39` |
| Compound false positives | **12** (raw count — there is no FPR %) | `docs/eval-report.md:37-39` |
| Hero lead time | **28 min**, `vsp_coke_oven` only, process time | `docs/eval-report.md:61,73-79` |
| Forecast FN rate | ~32% — **four different values across docs**; say "about 32%" or skip | `docs/eval-report.md:30` |
| Regulatory coverage | **100%** citable · **91.7%** Indian statutory · 576 cases with facts | `docs/eval-report.md:100-102` |
| MAH units | **1,861** (NDMA, sourced) | `docs/business-impact-model.md:81,124` |
| Incident cost | **₹50 cr** modeled (₹100–150 cr VSP-scale) | `docs/business-impact-model.md:27-37` |
| Fatalities/yr | 6,500 (brief/DGFASLI, no URL) — or **1,109** registered-factory, sourced | `docs/business-impact-model.md:82-83` |

**Housekeeping flagged during verification:** `docs/finals/pitch.md` is **untracked in git** — it
exists only as an uncommitted file in the main working tree. Commit it.
`docs/business-impact-model.md` is committed but orphaned — nothing references it; link it from
`README.md` and `CLAUDE.md`.
