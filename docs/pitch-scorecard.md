# Pitch one-pager — Compound risk, caught in time

**Claim:** Single sensors stay silent until gas hits critical. SOP Opera fuses
sub-critical gas + hot work without verified isolation + worker-in-zone into a
hazard *pathway*, blocks earlier, and cites the Indian provision that requires
stopping — with a human decision and a full audit trail.

## Headline numbers

From `app/eval/` — 593 labeled cases (393 requiring stop-work, 200 safe).
Regenerate with `python -m app.eval.run`.

| Detector | Accuracy | FN rate | Precision |
| --- | ---: | ---: | ---: |
| Single-sensor (critical OR) | 70.5% | **44.5%** | 100.0% |
| Predictive forecast (trend) | 66.3% | 31.8% | 78.1% |
| **Compound engine** | **98.0%** | **0.0%** | 97.0% |

**The line to say out loud:** *a conventional SCADA threshold alarm misses 175 of
393 plant states where a regulation requires stopping work. We miss zero.*

- **VSP lead time: 28 minutes** of plant process time (compound blocks at
  t+6 min; single-sensor critical at t+34 min). This is process time, not demo
  playback — the scenario replays in ~26 seconds but spans 34 minutes of plant time.
- **Regulatory coverage:** 100% of fact-bearing cases have a citable regulation;
  91.7% cite an Indian statutory provision.

### If a judge pushes on the numbers

Answer directly — the honesty is the strongest card we have.

- *"0% false negatives sounds too good."* It is **criterion coverage**, not a
  generalization claim: we implement the provisions, so we catch them. The
  meaningful number is the baseline scored on the *same* labels — 44.5% FN.
- *"Who wrote the labels?"* `app/eval/hazard_ground_truth.py`, from statutory
  stop-work criteria over raw sensor/permit payloads. It cannot import the risk
  policy it scores — `tests/test_eval_independence.py` fails the build if it does,
  and also fails if labels and detector ever agree on *every* case.
- *"What about your 12 false positives?"* Cases where we stop work and the statute
  does not strictly require it — hot work with unverified isolation and personnel
  present at a clean gas reading. For a stop-work system that bias is deliberate.
- *"How do you know the sweep isn't cherry-picked?"* It samples **exactly on** each
  threshold, not just comfortably past it. That is how we found a real defect: the
  elevated-gas rule used `>` while the statutory criteria used `>=`, so a reading
  sitting on the action level with personnel present was a silent miss. Fixed, and
  `tests/test_risk_policy.py` now fails if any band drifts back off `>=`.

## The risk model

Not a fact counter. Each derived fact supplies a hazard **dimension** —
atmosphere · ignition/energy · exposure · control failure — and blocking requires
a *pathway*: the full atmosphere+ignition+control chain, or personnel exposed to a
hazardous atmosphere, or incompatible simultaneous operations. Three unrelated
facts do not block. See `app/risk/policy.py` — the single source of truth, called
by the agent graph, the review service and the eval harness alike.

Projections cannot stop work: `predicted_trend_risk` and `spatial_cooccurrence`
escalate to *elevated* but can never ground a block.

## Regulatory basis (verified, clause-level)

| Provision | What it requires |
| --- | --- |
| Factories Act 1948 **s.37(1)(c)** | "exclusion or effective enclosure of all possible sources of ignition" — our compound thesis, in statute |
| Factories Act 1948 **s.36(2)** | confined space entry needs a competent person's written certificate |
| Factories Act 1948 **s.41H** | imminent danger to life/health → immediate remedial action |
| **OISD-STD-105** (Rev. I, 2004) | Work Permit System — hot work, confined space, isolation |

Each row carries a `clause` and a primary-source `source_url` in the database, so
a citation can be checked rather than trusted.

## Demo beat (90 seconds)

1. Run **vsp_coke_oven** on Digital Twin.
2. Compound **blocks at step 2** — elevated gas + hot work with unverified
   isolation — while gas is still below critical and *before* anyone enters the
   zone. Single-sensor stays silent for another 28 minutes of process time.
3. Open **Eval** (nav) — FN table, lead time, regulatory coverage.
4. (Optional) Nav → **Settings** — show live threshold editor if a judge asks how bands are tuned.
5. Supervisor decision → close (report freezes; elevated/hold closures promote into the incident corpus).
6. Webhook curl → Vessel A elevated → same twin path; show `/api/assessment-jobs/queue`.

## Where to look live

- Nav → **Eval** → FN table, 3-lane VSP timeline, handover coverage
- Nav → **Settings** → sensor/rule threshold editor (session-editable; backed by `GET|PUT /api/config/thresholds`)
- API → `GET /api/eval/summary`, `GET|PUT /api/config/thresholds`
- Source report → `docs/eval-report.md`

## Curl demo (SCADA adapter)

```bash
curl -s -X POST http://localhost:8000/api/ingest/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "source_system": "scada-historian",
    "asset_name": "Vessel A",
    "readings": [{"metric": "gas_reading", "value": 28.0, "unit": "ppm"}]
  }'

curl -s http://localhost:8000/api/assessment-jobs/queue
```

See [architecture-ingest.md](./architecture-ingest.md).

## Framing for judges

- Not predictive maintenance ML — **agentic Operational Review** at go/no-go.
- **The verdict is deterministic in every mode.** The LLM narrates; it never
  decides `risk_level`. That is what makes the eval scoreable at all. Out of the
  box (`AI_PROVIDER=mock`) there is no LLM call, and the UI says
  "deterministic narration · no LLM configured" rather than implying reasoning.
- Regulatory retrieval is **deterministic SQL, by choice** — it guarantees a
  citation is always present. Semantic (pgvector) retrieval is used for incident
  precedent. Do not describe the regulatory path as RAG.
- A generated summary cannot name a reference that was not retrieved
  (`app/assessment/citations.py` strips and flags unsupported citations).
- **Geospatial is evidence for the human, not a scored detector input** — this is
  a deliberate position, not an omission. See the section below.
- CCTV / autonomous emergency orchestrator = roadmap, not this demo.

## Tamper-evident audit trail

Every audit entry hashes its own content together with the previous entry's hash,
so any edit, deletion or reordering breaks the chain and `GET /audit/verify`
reports exactly where. This does not *prevent* tampering — a database owner can
always rewrite rows — it makes tampering **detectable**, which is what an auditor
needs. Evidence freezes context and assessment *content*, not just ids, so a later
edit cannot silently change what a recorded decision rested on.

**20-second demo:** `GET /audit/verify` → `intact: true` → `UPDATE audit_entries
SET payload = ... ` by hand → verify again → `content_altered` at that exact seq,
plus a broken link on everything after it.

## Scalability

- **Durable queue with leases.** Jobs are claimed with `FOR UPDATE SKIP LOCKED`
  and stamped with `claimed_at`. A worker that dies mid-job used to strand its
  row in `generating` — and its review in `assessing` — until the next process
  restart; an expired lease is now reclaimed on the next poll.
- **"Never double-run" is enforced by the database**, via a partial unique index
  on `assessments(review_id) WHERE status IN ('pending','generating')` plus
  `ON CONFLICT DO NOTHING`, not by a check-then-insert that two concurrent
  transitions could both pass.
- **Bounded broadcast.** Each WebSocket client has its own queue and writer task;
  `broadcast()` never awaits a socket. One stalled tab used to block every client
  after it *and* the ingest path that called it. Depth and dropped-frame counters
  are live on the AI Ops page.
- Indexed `assessments(status)`, an `ivfflat` ANN index on
  `knowledge_chunks.embedding`, a bounded `GET /reviews`, and a 20+10 connection
  pool with pre-ping.

**Demo:** open ~30 tabs, wedge one, watch telemetry keep flowing and
`ws_dropped_frames` tick up on AI Ops instead of the plant going quiet.

## Geospatial: what it is and where it sits

`graph/kg.py` builds a real `networkx` graph over the plant floor plan — 53 nodes,
with `NEAR` / `ABOVE` / `BELOW` edges derived from actual Euclidean distance, not
hand-written adjacency. It drives the twin's proximity links, the distance and
floor-delta shown on each link, and the neighbourhood context the spatial agent
pulls when a review is elevated.

**Decision (for the pitch):** reframe — geospatial is **evidence quality for the
supervisor**, not a scored detector input. Do not invent a with-KG vs without-KG
FN column at the current scale. Say this before a judge cross-references the map
against `/eval`.

### Script beat (~20 seconds)

1. Twin map — proximity links, real distances (geometry is load-bearing for the
   *human*, not for the FN table).
2. Eval page — “This scorecard scores the rules engine alone. Spatial is off by
   design.”
3. One line if challenged — “Stop-work in statute is about plant state —
   atmosphere, permit, people — not tag topology. We won’t label cases to match
   our own knowledge graph. That would be circular.”

### Why the numbers ignore it (if a judge digs)

`eval/detectors.py` calls `classify(grounded, observations or [])`, and the harness
always passes nothing. So `spatial_hit` is structurally always false — every
headline metric is computed with geospatial switched off.

The KG itself is real: 53 nodes, Euclidean adjacency from `floor_plan_map.json`
(3 `NEAR`, 21 `ABOVE`/`BELOW`-class, 27 `LOCATED_IN`). Best-looking surface in
the product; contributes to zero scored metrics. That mismatch is intentional.

**Why we deferred a scored column — three reasons; the third is the real one:**

1. **Same-asset eval.** Every eval case puts context on one synthetic asset
   (`EVAL_ASSET`). Spatial only matters *across* assets; same-asset distance is
   0.0 m — a co-location tautology. Scoring it means new cross-asset cases, not
   flipping a flag.
2. **Harness is DB-free.** Eval is deterministic and does not hit Postgres. The
   KG loads from JSON (fine), but real spatial observations come from the agent
   node reading plant-neighborhood context from the DB. Hand-synthesizing
   observations scores a fixture we wrote; plumbing the real call couples eval
   to the live plant.
3. **Independent labels have no geometry.** `hazard_ground_truth` reads a flat
   list of entries and asks “does a stop-work provision apply?” — not “on which
   asset, how far apart.” A cross-asset criterion (elevated gas on Vessel A,
   hot work within N metres on Walkway 3) requires making the *labeler*
   spatially aware first. Add cross-asset cases without that and you either
   can’t score them, or you label them to match what the spatial agent does —
   the circularity W2 removed.

What’s already in place for a later bolt-on: `compound_alarm` already accepts an
`observations` parameter (added in W2 for exactly this), and `EVAL_ASSET` sits on
a `NEAR` edge to another asset.

**Honest expectation if we did score it:** with only 3 same-floor `NEAR` edges and
a same-asset hero scenario, spatial won’t move the headline FN rate. What it
buys is a with-KG vs without-KG column over a handful of cross-asset cases —
turning “we have a knowledge graph” from an assertion into a measured delta,
however small. Do that only when the ground truth has a distance-based
criterion; flipping `observations` first would be worse than leaving it out.

## Known gaps (say these before a judge finds them)

- `POST /api/ingest/webhook` is unauthenticated with no idempotency key or rate
  limit — fine for a demo, not for a plant.
- Workers are in-process asyncio tasks. The queue is now safe for multiple
  processes, but the ambient simulator still starts once per process, so
  `--workers N` would produce N telemetry generators.
