# Q&A Ammunition — Finals, 25 Aug 2026

Companion to `docs/finals/pitch.md` (the 7-minute script). One question per section, each
answer ending in the exact file:line it's grounded in. Every claim here was re-verified
against the current code today — not pulled from CLAUDE.md's prose or an older workplan's
description of what should exist. Where a claim doesn't check out, that's stated plainly
instead of stretching a citation to cover it.

---

## 1. Why not just use GPT-4?

Out of the box, this product makes **zero LLM calls**. `AI_PROVIDER` defaults to `mock`,
and `get_chat_model()` returns `None` for that setting — no network call happens, and every
narration is a deterministic template. The UI says so directly: a tooltip on the assessment
panel reads *"No LLM is configured (AI_PROVIDER=mock). Facts, verdict and recommendations are
deterministic; the narration is templated rather than generated"* and renders the literal
label "deterministic narration · no LLM configured."

When a provider *is* configured (`openai_compatible` or `ollama` are both wired), the
separation that matters doesn't change: the LLM only ever writes the free-text `summary`.
`risk_level` is computed by the deterministic policy engine **before** the LLM is called, and
is passed into the summary step as an already-fixed value — the model narrates a verdict, it
never sets one. So "why not GPT-4" isn't really the axis to compare on; the axis is that the
verdict was never the LLM's job in the first place, on any provider.

**Grounded in:** `backend/app/agents/llm.py:29-38` (`get_chat_model()`, mock → `None`),
`backend/app/core/config.py:33` (`ai_provider: str = "mock"`),
`backend/app/agents/nodes/orchestrator.py:420-421` (`risk = require_grounding_for_block(...)`
computed first), `orchestrator.py:425-427` (LLM summary called after), `orchestrator.py:481-486`
(`AssessmentResult(summary=summary, risk_level=risk, ...)` — two different sources),
`frontend/components/assessment/AssessmentPanel.tsx:148-154`

---

## 2. Isn't this just a rules engine?

The rules only produce **facts** — 17 `rule_*` functions, each reading one context entry in
isolation. What turns facts into a verdict is a separate hazard-*pathway* model: four
dimensions (atmosphere, ignition/energy, exposure, control-failure), and the policy blocks
when facts complete a **pathway** across dimensions, not when a fact count crosses a number.
The module's own docstring argues against the predecessor design directly: the old rule was
`len(rule_facts) >= 3 -> blocking`, which the current author calls out by name as measuring
"how much we know, not how dangerous the state is."

Concretely: three unrelated facts on three different assets don't block anything under this
model. A flammable atmosphere reading, plus an unisolated ignition source, plus a control
failure — on the *same* pathway — does, even if that's only two or three facts total. That's
the difference between fact-counting and pathway detection.

One rule worth naming as evidence the fact layer isn't purely numeric: `rule_supervisor_floor_report`
reads a human's live floor-report entry and classifies its *qualitative* concern type into a
fact — it's not a threshold comparison, it's parsing what a person on the floor actually
reported.

**Grounded in:** `backend/app/risk/policy.py:9-26` (docstring rejecting fact-counting),
`policy.py:55-72` (`HAZARD_DIMENSIONS`), `policy.py:193-339` (`classify()`, pathway clauses),
`backend/app/context/derived_facts.py:443-468` (`rule_supervisor_floor_report`),
`derived_facts.py:597-614` (rule registry — 17 `rule_*` functions defined in the file,
confirmed by `grep -c "^def rule_"`)

---

## 3. Is any of this real data?

The regulatory corpus is real, not paraphrased: 5 clause-level entries in `INDIAN_REGULATIONS`
(Factories Act 1948 s.37(1), s.36(2), s.41H, s.41B; OISD-STD-105), each carrying a specific
`clause` field (e.g. `"s.37(1)"`) and a primary-source `source_url` pointing at the actual
statute text (indiankanoon.org), not a summary page. A separate guard, `citations.py`, strips
any citation the model names in a summary that wasn't actually among the retrieved references
— a generated answer can't cite a document it never saw.

What's synthetic, plainly: 5 scripted YAML scenarios for demo replay, a randomized combinatorial
engine, and an always-on low-signal ambient telemetry feed. All three land on the same
`ingest_context` seam a real SCADA/PTW integration would use — nothing about the pipeline
downstream of ingest knows or cares that the source is a script instead of a plant.

**Honest gap:** the synthetic-data disclosure is live at the landing page and the login
page ("Demo build — seeded plant, simulated context providers"), but a CSS comment in the
frontend references an in-app "app-shell badge" that would carry the same disclosure *inside*
the running twin/operator view — that badge does not currently exist. If a judge asks where
the running app itself says "this is simulated," the honest answer is: not yet, only at the
door.

**Grounded in:** `backend/app/db/seed_embeddings.py:114-182` (`INDIAN_REGULATIONS`, 5 entries),
`seed_embeddings.py:197-200` (clause/source_url consumption),
`backend/app/assessment/citations.py:66-96,196-214` (`check_citations`/`strip_unsupported`),
`backend/app/simulator/scenarios/*.yaml`, `backend/app/simulator/random_engine.py:1`,
`backend/app/simulator/ambient.py:1-7`,
`frontend/components/landing/LandingFooter.tsx:43`, `frontend/app/login/page.tsx:151`
— gap: no matching badge found in `frontend/components/nav/AppShell.tsx` or `TopNav.tsx`

---

## 4. What's your false-alarm rate?

Stated plainly: **there is no headline false-positive-rate number today.** `eval/metrics.py`
computes accuracy, recall, false-*negative* rate and precision as reportable properties, but
never a false-positive-rate property. `docs/eval-report.md` quotes a raw count instead — 12
false positives out of a 200-case safe subset — not a percentage. That's a real gap in the
scorecard, and naming it beats a judge finding the missing metric first.

What is real and worth leading with instead: a 4-tier response engine that bounds the
*consequence* of any alarm, true or false, before it's allowed to act autonomously. Every
proposed autonomous action passes a 4-clause gate — is it reversible, does it move the plant
toward safety, is its blast radius bounded to the affected zone (not plant-wide), and does its
tier even permit automation (`Preserve`/`Warn`/`Protect` do, `Never automatic` never does). All
four must pass, or the system declines and shows which clause stopped it. A false alarm under
this design can trigger a scoped, reversible response — never an irreversible or plant-wide
one.

**Grounded in:** `backend/app/eval/metrics.py:31-57` (`DetectorMetrics` — no FPR property),
`metrics.py:96-97` (false-negative rate framed as the headline metric),
`docs/eval-report.md:27-31,38-39,51` (raw FP count, no rate — the gap),
`backend/app/eval/detectors.py:18-23,26-43,46-81` (the three detector functions),
`backend/app/response/envelope.py:10-23` (the four clauses, documented),
`envelope.py:48` (`MAX_AUTONOMOUS_TIER = 2`), `envelope.py:202-207` (`TIER_LABELS`),
`envelope.py:233-309` (`may_execute_autonomously()`, all-four-pass gate),
`backend/app/response/service.py:69-99` (`affected_zones()` — blast-radius bound),
`service.py:105-114` (`tiers_for()`)

---

## 5. Your product assumes an instrumented plant — what about the rest of it?

It doesn't require full SCADA coverage to function. Two manual paths exist on the same
downstream seam as automated telemetry: `POST /context` accepts a manually-entered context
payload from a permit officer or supervisor and routes it through the identical
facts → review → assessment pipeline a sensor feed would use. And when there's no automated
pipeline output at all — AI unavailable, or a judgment call a human wants to make directly —
a supervisor can author a **manual assessment** by hand, which supersedes any in-flight AI
job for that review.

**Grounded in:** `backend/app/context/routes.py:24-33` (`POST /context`),
`backend/app/assessment/manual.py:1,23-34` (`create_manual_assessment()`),
`manual.py:49-65` (supersedes in-flight AI jobs),
`backend/app/reviews/routes.py:413-430` (`POST /{review_id}/assessments/manual`)

---

## 6. Why no DGMS routing?

Not an omission — a deliberately removed fabrication. An internal audit (`docs/audit-2026-07.md`)
found an earlier version of this product cited a `DGMS Circular 2017` that doesn't exist (no
number, no series) and, worse, DGMS has no regulatory jurisdiction over a steel-plant coke
oven in the first place — that falls under the Factories Act inspectorate, a different
authority entirely. The audit dropped that citation and replaced it with verified Factories
Act 1948 clauses (s.37(1), s.36(2), s.41H) that actually apply to the scenario.

Said straight: there is no regulator-notification or escalation-routing feature in the code at
all, to DGMS or anyone else. If asked about routing generally rather than DGMS specifically,
that's the honest scope — the product ends at a recorded human decision and a frozen packet,
not an automated regulatory filing.

**Grounded in:** `docs/audit-2026-07.md:107` (fabricated DGMS citation finding),
`audit-2026-07.md:110-111` (no regulatory-coverage metric existed either),
`audit-2026-07.md:237-241` (replacement Factories Act citations),
`audit-2026-07.md:239` (`DGMS Circular 2017` — dropped),
`audit-2026-07.md:261-262,281-282` (remediation record)

---

## 7. Why no vernacular UI?

Genuine gap — no internationalization exists in the current code at all. No `next-intl`,
`react-i18next`, or any i18n library in `frontend/package.json`; no `/locales` or `/i18n`
directory; no language-switcher component anywhere in the frontend. Every string, down to
`aria-label`s, is hardcoded English.

This is worth naming as roadmap rather than defending — a plant floor in India runs on more
than English, and a real deployment would need at minimum Hindi and the relevant state
language before it could sit on a control-room wall.

**Grounded in:** `frontend/package.json:14-34` (full dependency list, no i18n library present),
`frontend/components/twin/DigitalTwin.tsx:680-681,720,781` (representative hardcoded strings)

---

## 8. How can I trust one agent?

The premise doesn't hold — it isn't one agent. `build_graph()` wires 8-9 LangGraph nodes:
four source agents (scada, permit, maintenance, workforce), plus spatial, predictive-trend,
shift-handover, and incident-pattern agents, plus the orchestrator — fanned out **selectively**
by deterministic routing conditions, so a nominal asset never wakes the full fleet.

More importantly, none of those agents decide anything. Every one of them produces facts and
observations only. Those facts feed a single deterministic policy function —
`risk.policy.classify()` — which is the sole place a verdict gets computed, and it runs
*before* any LLM step. The orchestrator's free-text summary is generated afterward and cannot
change the verdict it's describing. On top of that, a separate guard strips any citation in
that summary that wasn't actually retrieved, before a human ever sees it.

So the trust question isn't "can I trust one model's judgment" — no model's output ever
reaches `risk_level`. It's closer to: multiple narrow specialist readers feed one auditable,
non-LLM decision function, and the model's only job is to explain that decision in prose,
under a citation guard.

**Grounded in:** `backend/app/agents/graph.py:86-127` (`build_graph()`, node wiring),
`backend/app/agents/routing.py:10` (`SOURCE_AGENTS`), `routing.py:31-50,89-98,101-116,119-122,125-135`
(selective gating conditions), `backend/app/risk/policy.py:1-7` (module docstring: sole source
of truth), `policy.py:193-339` (`classify()`),
`backend/app/agents/nodes/orchestrator.py:23-27` (`_fuse_verdict` delegates to policy),
`orchestrator.py:420-421` (verdict computed first), `orchestrator.py:425-427,455-457,481-486`
(summary computed after, citation check, and the two-source `AssessmentResult`),
`backend/app/assessment/citations.py:66-96,196-214` (citation-stripping guard)

---

## 9. Where did the discovered patterns come from?

Correcting the premise directly: an automated candidate-pattern-discovery feature (internally
scoped as "W13") was never built and then reverted — it was scoped and **deliberately,
permanently deferred**, confirmed both by the finals coverage doc and by the commit that most
recently touched that scoping decision. There is no pattern-mining UI anywhere in the current
frontend or backend — verified by search, zero matches.

The real answer to "where do patterns come from" has two parts. First, the hazard-pathway
dimension model itself (same mechanism as Q2) is where compound, multi-signal patterns get
recognized — atmosphere + ignition + control-failure co-occurring is a pattern, computed
deterministically, not mined. Second, for genuine historical-incident precedent, there's a
dedicated incident-pattern agent: when vector or SQL retrieval actually returns real historical
incident rows, those are used and cited normally. Its offline fallback content — for when
retrieval comes up empty — is explicit, hardcoded, and *deliberately carries no similarity
score*, specifically so a fallback note can never be mistaken for a real match with a
confidence number attached to it.

**Grounded in:** `docs/finals/brief-coverage.md:12` ("Ranked candidate-rule mining (W13) is
deliberately not built"), git commit `33683a0` ("W13 candidate-rule mining is the part that
would close that, and it is deliberately not built"),
`backend/app/risk/policy.py:55-72,193-339` (dimension model),
`backend/app/agents/nodes/incident_pattern.py:1` (module docstring),
`incident_pattern.py:9-49` (`FACT_PATTERN_ECHO` — labeled fallback, no similarity score),
`incident_pattern.py:51-56` (`_incident_refs()` — real retrieval path)

---

## 10. What happens when a sensor is down?

**This has a product answer — demo it live, don't just describe it.**

A dedicated module, `context/coverage.py`, classifies every asset into `assessed`, `degraded`,
or `blind`, computed independently of and never feeding into risk: no reading ever arrived, or
the last reading is older than the staleness threshold → `blind`, with a reason string like
"No sensor reading for N min — absence of data, not safety." A self-reported fault or
low-confidence reading → `degraded`, naming the fault. Otherwise → `assessed`. This is
explicitly carried as an orthogonal field, never a fourth risk level, and never changes a
verdict — a rule CLAUDE.md itself codifies as load-bearing ("do not put absence-of-data
detection into a `rule_*` function").

It's wired all the way to the hero surface: `GET /assets/coverage` is polled by the twin
component, threaded down through the floor-plan renderer, and drawn directly on each asset
marker as a coverage ring plus a "blind" slash overlay — with an `aria-label` calling out
degraded/blind state for anyone not just eyeballing color. A judge can watch a sensor go stale
on the live map and see the marker change, distinct from an actual safe reading.

**Grounded in:** `backend/app/context/coverage.py:1-22` (module docstring — "blind, not safe"),
`coverage.py:49-71` (`_degraded_reason()`), `coverage.py:74-106` (`classify_coverage()`),
`coverage.py:109-174` (`sensor_last_seen()`, dual-table staleness check),
`coverage.py:177-216` (`coverage_for_assets()`),
`backend/app/context/routes.py:43-60` (`GET /assets/coverage`),
`backend/app/context/schemas.py:51` (`AssetCoverageOut`),
`frontend/components/twin/DigitalTwin.tsx:26-27,196-211,658` (poll + threading),
`frontend/components/twin/FloorPlan.tsx:66-67,349,614-643` (prop threading to markers),
`frontend/components/twin/AssetMarker.tsx:13-14,31,58,72,77-89` (ring + blind-slash render,
aria-label)

---

## 11. How do you know your eval numbers aren't circular?

The ground-truth labels are written by a module (`eval/hazard_ground_truth.py`) that is
structurally forbidden from importing the risk engine it scores. That's not just a comment —
it's enforced by tests that parse the module's AST and fail the suite if it ever imports
`app.risk`/`app.risk.policy` or calls `evaluate_rules`/`classify`/`compound_alarm`/`_fuse_risk`.
A second test guards against the labels quietly collapsing back onto the detector: it asserts
the compound detector and the ground-truth labels **disagree on at least one case** — perfect
agreement is treated as the strongest signal that circularity crept back in, not as a good
result.

This replaced an earlier version where ground truth was defined as "whatever the detector
does," which is why the compound engine used to score a 0% false-negative rate by
construction — that number was unfalsifiable, and the current harness exists specifically to
make that regression loud instead of silent if it ever happens again.

**Grounded in:** `backend/app/eval/hazard_ground_truth.py:1-27` (module docstring, independence
rules), `backend/tests/test_eval_independence.py:1-10` (docstring naming the original flaw),
`test_eval_independence.py:22-23` (`FORBIDDEN_MODULES`/`FORBIDDEN_NAMES`),
`test_eval_independence.py:37-43` (`test_ground_truth_does_not_import_the_risk_policy`),
`test_eval_independence.py:46-60` (`test_ground_truth_does_not_call_the_rule_engine`),
`test_eval_independence.py:63-77` (`test_labels_and_detector_actually_disagree_somewhere`)

---

## 12. What's your security posture — auth, rate limits?

Named as a known limitation, not a strength: the ingest webhook (`POST /api/ingest/webhook`,
the adapter a real SCADA historian would post to) has no authentication dependency and no rate
limiting — anyone who can reach the endpoint can inject plant context. That's an acceptable
posture for a hackathon demo on a closed network; it is not acceptable for a real plant
deployment, and would need an API key or mTLS plus rate limiting before this seam could face
an actual historian.

**Grounded in:** `backend/app/context/ingest_routes.py:20-24` (`post_webhook` — no `Depends`
auth check on the route)

---

## Sources not directly cited above

- `docs/finals/pitch.md` — the 7-min script this doc supports; §7 there ("Things to say before
  a judge finds them") overlaps with several gaps named here (webhook, geospatial-not-scored,
  no-LLM-by-default).
- `docs/audit-2026-07.md` — full remediation record behind Q6 and the broader "what did we
  fix after the prelims" story, if asked.
