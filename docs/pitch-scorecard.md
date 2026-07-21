# Pitch one-pager — Compound risk, caught in time

**Claim:** Single sensors stay silent until gas hits critical. SOP Opera fuses
sub-critical gas + hot work without verified isolation + worker-in-zone into a
hazard *pathway*, blocks earlier, and cites the Indian provision that requires
stopping — with a human decision and a full audit trail.

## Headline numbers

From `app/eval/` — 377 labeled cases. Regenerate with `python -m app.eval.run`.

| Detector | Accuracy | FN rate | Precision |
| --- | ---: | ---: | ---: |
| Single-sensor (critical OR) | 76.9% | **33.9%** | 100.0% |
| Predictive forecast (trend) | 65.0% | 35.8% | 80.5% |
| **Compound engine** | **97.9%** | **0.0%** | 97.0% |

**The line to say out loud:** *a conventional SCADA threshold alarm misses 87 of
257 plant states where a regulation requires stopping work. We miss zero.*

- **VSP lead time: 28 minutes** of plant process time (compound blocks at
  t+6 min; single-sensor critical at t+34 min). This is process time, not demo
  playback — the scenario replays in ~26 seconds but spans 34 minutes of plant time.
- **Regulatory coverage:** 100% of fact-bearing cases have a citable regulation;
  91.1% cite an Indian statutory provision.

### If a judge pushes on the numbers

Answer directly — the honesty is the strongest card we have.

- *"0% false negatives sounds too good."* It is **criterion coverage**, not a
  generalization claim: we implement the provisions, so we catch them. The
  meaningful number is the baseline scored on the *same* labels — 33.9% FN.
- *"Who wrote the labels?"* `app/eval/hazard_ground_truth.py`, from statutory
  stop-work criteria over raw sensor/permit payloads. It cannot import the risk
  policy it scores — `tests/test_eval_independence.py` fails the build if it does,
  and also fails if labels and detector ever agree on *every* case.
- *"What about your 8 false positives?"* Cases where we stop work and the statute
  does not strictly require it — hot work with unverified isolation and personnel
  present at a clean gas reading. For a stop-work system that bias is deliberate.

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
4. Supervisor decision → close.
5. Webhook curl → Vessel A elevated → same twin path; show `/api/assessment-jobs/queue`.

## Where to look live

- Nav → **Eval** → FN table, 3-lane VSP timeline, threshold editor
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

**It is not an input to the scored detectors, by choice.** Two reasons, and we say
both plainly:

1. The stop-work criteria our labels come from are written about the plant state —
   atmosphere, permitted work, personnel — not about tag topology. Feeding geometry
   into the detector without a spatially-aware ground truth would mean labeling
   those cases to match what our own spatial agent does, which is exactly the
   circular metric we removed from this harness.
2. At the current floor-plan scale the graph has 3 same-floor `NEAR` edges, and the
   hero scenario is single-asset. A "with KG vs without KG" column would be a
   rounding error dressed as a result.

So geospatial earns its place as **evidence quality** — it shows a supervisor *where*
the hazard is and what is next to it — and we do not claim it moves the
false-negative number. Making it a scored input means first extending the ground
truth with a distance-based criterion; that is real work, and we would rather name
it as the next step than fake a number for it.

## Known gaps (say these before a judge finds them)

- `POST /api/ingest/webhook` is unauthenticated with no idempotency key or rate
  limit — fine for a demo, not for a plant.
- Workers are in-process asyncio tasks. The queue is now safe for multiple
  processes, but the ambient simulator still starts once per process, so
  `--workers N` would produce N telemetry generators.
