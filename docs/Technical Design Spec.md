# Technical Design Specification (TDS)
### Operational Review Platform — v1.0

Source of truth, in order: PRD v3 → Canonical Domain Model v1.0 → System Interaction & Workflow Specification v1.0 → this document.
Audience: 4 engineers, 10-day build, implementing directly against this spec in Cursor.
Status: Final for implementation. Update in place as decisions are made; don't let this drift from what's actually built.

**Two flags carried forward, not blocking, worth a 5-minute team conversation before Day 1:**
1. Ollama's structured-output reliability varies by local model. Budget time on Day 3–4 to pick a specific local model that actually holds the schema under retry, rather than discovering this on Day 8.
2. "Manual asset mapping" for the Digital Twin is interpreted below as a static config file authored once by an engineer, not a runtime mapping UI — consistent with "no CRUD, no management UI" elsewhere. Flag now if that's wrong.

---

## 1. Overview

The platform runs Operational Reviews for a single plant, single tenant. A Review opens, gathers Context from two providers (Manual Input, Simulator), triggers an AI-generated Assessment over deterministically derived facts, and closes once a human Decision Maker accepts or rejects the AI's Recommendations. The Digital Twin — a static 2D SVG floor plan with clickable, highlightable assets — is the primary way a human sees *why* the AI said what it said. That evidence trace, live, driven by real backend state, is the product's signature moment and the highest-priority thing to get right.

Everything in this document optimizes for one outcome: four engineers building this in parallel without blocking each other, arriving at a working, demo-ready system in 10 days that is also clean enough to keep building on afterward.

---

## 2. Engineering Principles

- **The three-way ownership split is enforced in code, not convention.** The AI service can only ever write Assessments and Recommendations. Only a Decision endpoint, invoked by a human-selected role, can write a Decision. Only the Review state machine service can change `reviews.state`. No other code path touches these tables.
- **Derived Facts are deterministic and computed synchronously.** No LLM call ever sees raw Context. Rule functions run in plain Python.
- **Structured output is enforced, not hoped for.** Every AI call validates against a Pydantic schema. One retry. Then fail loud — a failed Assessment is a valid, visible state, never a silent stall.
- **State transitions are centralized.** One function is the only legal way to move a Review from one state to another. Nothing else mutates `reviews.state` directly.
- **No infrastructure the demo doesn't need.** No message broker, no Kubernetes, no CRUD UI for fixtures, no hash-chained audit log. If it doesn't make the Assessment Pipeline or the Digital Twin better, cut it.
- **Broadcast over targeting.** Single tenant, single plant, a handful of concurrent demo users — every WebSocket event goes to every connected client. The frontend filters by relevance. Building per-user event routing here is solving a problem that doesn't exist yet.
- **When in doubt, protect these two:** the Operational Assessment Pipeline and the Digital Twin. Every other component should be built at the minimum quality that keeps those two credible.

---

## 3. High-Level Architecture

```text
                         ┌─────────────────────────────────────────┐
                         │              React Frontend             │
                         │  Review UI · Digital Twin · AI Ops ·    │
                         │  Reports · Notifications · Demo Mode    │
                         └───────────────┬─────────────┬───────────┘
                                REST     │             │  WebSocket
                                         ▼             ▼
                         ┌─────────────────────────────────────────┐
                         │              FastAPI Backend            │
                         │  ┌───────────────────────────────────┐  │
                         │  │   Review State Machine (central)  │  │
                         │  └───────────────────────────────────┘  │
                         │  Context Engine → Derived Facts Engine  │
                         │  Assessment Pipeline (async; Orchestrator│
                         │  drives retrieval, provider select, retry)│
                         │  Reports · Notifications · Audit · AI Ops│
                         │  WebSocket Connection Manager (broadcast)│
                         └───────────────┬─────────────┬───────────┘
                     Manual Input        │             │  Simulator
                     (via REST)          ▼             ▼  (in-process bg task)
                         ┌─────────────────────────────────────────┐
                         │              PostgreSQL                 │
                         └─────────────────────────────────────────┘

```

One process, one database, one frontend app. The Simulator runs as a background asyncio task inside the same FastAPI process — it is not a separate service, and it talks to the Context Engine through the exact same internal interface Manual Input uses.

### 3.1 Component Responsibility Matrix

Purely to reduce ownership confusion during implementation — if a PR touches something outside the "Owns" column, that's a signal to check whether it belongs somewhere else first.

| Subsystem | Owns | Does Not Own |
| --- | --- | --- |
| **Operational Review** | Review lifecycle, state transitions, participant assignment | AI reasoning, Assessment content, visualization |
| **Assessment Pipeline** | AI orchestration (retrieval decision, provider selection, retries, validation), Assessment + Recommendations, confidence, observability | Decisions, Review lifecycle, Digital Twin rendering |
| **Digital Twin** | Visualization, evidence overlays, spatial/asset state | Simulation, Assessment generation, Decision logic |
| **Simulator** | Context generation (scripted scenarios) | AI reasoning, Review logic |

---

## 4. Core Data Flow

1. A Context Provider (Manual Input or Simulator) emits a canonical Context record.
2. The Context Engine persists it and synchronously runs the Derived Facts rules against currently-valid Context for the affected Asset.
3. The **Assessment Orchestrator** is the single owner of all reassessment decisions. When Context changes, it executes a deterministic `should_reassess(review, changed_context)` check. Minor telemetry fluctuations do not trigger new runs; only material changes to derived facts (e.g., significant gas increase, worker enters hazardous zone, permit state changes, or equipment status changes) automatically re-trigger Assessment (Review → `Assessing`).
4. When a Review enters `Assessing`, an Assessment job is created (`status = pending`), and a background task picks it up.
5. The **Assessment Orchestrator** (Section 5.4) takes the job: it deterministically decides, from the active Derived Facts alone, whether retrieval is required; if so it fetches the relevant Regulations, historical Incidents, and/or SOPs before building anything. It then builds a prompt from Derived Facts + Context references + any retrieved evidence, calls the active AI provider, validates the structured response, retries once on failure, and persists Assessment + Recommendations (or marks the job `failed`).
6. A WebSocket event (`assessment.completed` or `assessment.failed`) broadcasts to all clients.
7. Frontend updates the Review view and the Digital Twin (asset highlight state is derived from the latest Assessment + active Derived Facts).
8. A Decision Maker submits a Decision. Evidence (the specific Context + Assessment relied on) is frozen at this instant.
9. Review closes → Report generated → Notification events fire → Audit entries have already been written at every step above, not as a final pass.

---

## 5. System Components

### 5.1 Operational Review

The state machine is the spine of the backend. Full state set is implemented; the demo exercises the primary path.

```text
Opened → Assessing → Pending Decision → Decided → Closed
                 ↑             │
                 └─────────────┘  (new material Context)
Pending Decision → Escalated → Pending Decision / Decided
Closed → Reopened → Assessing

```

One service owns every transition:

```python
def transition_review(review_id: UUID, event: ReviewEvent) -> Review:
    """The only legal way to change reviews.state. Validates the
    current state allows this event, applies it, writes an Audit
    Entry, and broadcasts review.status_changed. Everything else
    reads state; nothing else writes it."""

```

### 5.2 Context Engine

Two providers, one interface:

```python
class ContextProvider(Protocol):
    async def emit(self, context: ContextIn) -> ContextRecord: ...

```

`ManualInputProvider` — thin wrapper around a REST endpoint a human posts to.
`SimulatorProvider` — background task replaying a scripted scenario timeline.

Both call the same internal `ingest_context()` function, which persists the record and triggers Derived Facts recomputation. This is the seam a future third provider (SAP, SCADA, whatever) would implement — build no more of it than these two need.

### 5.3 Derived Facts Engine

Pure functions, no side effects beyond the write:

```python
DERIVED_FACT_RULES: list[Callable[[list[ContextRecord]], DerivedFact | None]] = [
    rule_elevated_gas,       # Gas reading > threshold → Elevated Gas
    rule_permit_conflict,    # Overlapping permits on same Asset → Permit Conflict
    rule_zone_occupied,      # Worker location inside hazardous zone → Zone Occupied
]

```

Run synchronously whenever Context is ingested for an Asset. Results are stored (`derived_facts` table), not recomputed on the fly at Assessment time — the Assessment Pipeline reads the current derived state, it never re-derives it.

### 5.4 Assessment Pipeline — protected subsystem

This and the Digital Twin get the majority of engineering time. No message broker: an in-process asyncio task picks up `assessments` rows with `status = pending`. This is a deliberate simplification (see Section 13) and does not weaken the pipeline's actual behavior.

#### 5.4.0 Assessment Orchestrator

One object owns the pipeline end to end. Nothing else in the codebase decides what happens between "Review entered `Assessing`" and "Assessment persisted."

```python
class AssessmentOrchestrator:
    """The only thing that coordinates an Assessment run.

    Responsibilities:
      - explicitly own all reassessment decisions via should_reassess()
      - pick up pending assessment jobs
      - decide, deterministically, whether retrieval is required
      - run retrieval (Regulations / Historical Incidents / SOPs) if so
      - build the prompt from Derived Facts + Context + retrieved evidence
      - select the configured AI provider
      - call it, validate the structured response, retry once on failure
      - persist Assessment + Recommendations, or mark the job failed
      - write the AI Observability record on every attempt
      - track assessment_version on Supersede
    """

```

**Reassessment Logic.** The Orchestrator alone determines if an Assessment needs to be regenerated after Context changes. The `should_reassess(review, changed_context)` function relies on material changes to derived facts (e.g., equipment status shifts, hazard zone breaches) rather than reacting to every incoming telemetry event.

**Deterministic Retrieval.** Every reference to Retrieval in this pipeline is explicitly deterministic. The Orchestrator—not the LLM—decides whether additional evidence is required. Based on active Derived Facts, the Orchestrator fetches examples such as relevant regulations, similar historical incidents, or Standard Operating Procedures (SOPs). There is no autonomous tool calling or agentic behavior; the LLM only reasons over the strict information it is given.

```python
RETRIEVAL_RULES: dict[str, list[Literal["regulations", "historical_incidents", "sops"]]] = {
    "elevated_gas": ["regulations"],
    "permit_conflict": ["sops", "regulations"],
    "zone_occupied": ["historical_incidents"],
}

```

```python
class RetrievedEvidence(BaseModel):
    source: Literal["regulations", "historical_incidents", "sops"]
    id: UUID

```

**AI Providers.**

```python
class AIProvider(Protocol):
    async def generate_assessment(
        self, derived_facts: list[DerivedFact], context_refs: list[UUID],
        retrieved_evidence: list[RetrievedEvidence] | None
    ) -> AssessmentResult: ...  # raises on schema failure

```

* `OpenAICompatibleProvider` — uses schema-constrained structured output (JSON schema / tool-calling).
* `OllamaProvider` — JSON-mode prompting + explicit Pydantic validation for local models.
* `MockProvider` — returns deterministic Assessment objects conforming to the exact same schema. This is a critical development convenience for frontend development, offline work, testing, demos, and CI without API keys.

Flow: retrieve (if required) → generate → validate → **on failure, one retry with a repair instruction appended** → on second failure, `status = failed`, Review stays in `Assessing`, visibly. Recommendations are a field on the Assessment result, not a separate pipeline stage.

#### 5.4.1 AI Observability

Captured on every attempt, success or failure:

```python
class AssessmentMetadata(BaseModel):
    provider: str            # "openai" | "ollama" | "mock"
    model: str
    prompt_version: str
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float   
    latency_ms: int
    timestamp: datetime
    retrieved_context_ids: list[UUID]
    retrieved_evidence_ids: list[UUID]   
    confidence: float
    assessment_version: int     

```

The AI Ops dashboard (Section 6) is a read-only aggregation view over this table. In addition to standard aggregations, the dashboard tracks **Assessment Success Rate**, **Failed Assessments**, and **Validation Failures** to provide immediate visibility into pipeline health and model reliability during the demo.

This table is intentionally collected at a finer grain than the dashboard needs. The captured metadata intentionally enables future engineering hooks—such as prompt experimentation, provider comparison, model benchmarking, regression testing, and cost optimization. These are future capabilities, not MVP features.

### 5.5 Digital Twin — protected subsystem

Not a simulator. A static SVG floor plan for the single plant, with asset locations authored once as a config file:

```json
// floor_plan_map.json
{
  "asset_id_1": { "svg_element_id": "vessel-a", "x": 240, "y": 180 },
  "asset_id_2": { "svg_element_id": "walkway-3", "x": 310, "y": 220 }
}

```

Rendering is entirely frontend logic. Clicking an asset opens a side panel showing its current Context, Evidence (if any Review has frozen some), and Incident history. No CAD editing, no automated mapping, no 3D.

**Evidence panel traces the reasoning path.** The side panel lays out, top to bottom, exactly why the AI reached its conclusion: Asset → Context → Derived Facts → Retrieved Evidence → Assessment → Recommendations → Decision.

### 5.6 Simulator

A deterministic scenario engine, not a plant model. To make new scenarios easy to author without modifying Python code, the Simulator is driven by a lightweight **Scenario DSL** defined in JSON or YAML.

```yaml
# scenarios/compound_risk.yaml
name: "Compound Risk"
steps:
  - delay_seconds: 0
    type: "sensor_update"
    payload: { "gas_reading": 25.5, "asset_id": "vessel-a" }
  - delay_seconds: 15
    type: "worker_movement"
    payload: { "worker_id": "w-1", "zone": "hazardous" }
  - delay_seconds: 10
    type: "permit_change"
    payload: { "permit_id": "p-1", "status": "active" }

```

**Deterministic Execution.** Demo Mode always replays scenario files with identical timing and event ordering. This guarantees reproducible demos, reliable recordings, easier debugging, and a consistent judging experience. No simulator UI — control is entirely through Demo Mode buttons in the main frontend.

### 5.7 Reports

Generated once per closure event, not once per Review. Stored as a row with rendered structured content (title, summary, Assessment snapshot, Decision, accepted/rejected Recommendations, Evidence references). Render to a read view in the frontend.

### 5.8 Notifications

Reacts to the Domain Events list from the SIWS. In-app only, delivered over the same WebSocket channel. Must never block delivery: if AI summarization fails, fall back to a deterministic template.

---

## 6. Frontend Architecture

**Stack:** React + TypeScript + Vite. TanStack Query for server state. Minimal global client state (Zustand).

**Structure:**

* `ReviewList` / `ReviewDetail` — the core workflow screens, state-machine-aware.
* `DigitalTwin` — SVG viewer + toggleable side panel, subscribes to WebSocket stream.
* `AssessmentPanel` — shows the AI's Assessment, Recommendations, and confidence.
* `AIOpsDashboard` — read-only, polls/subscribes to aggregate metrics including Assessment Success Rate, Failed Assessments, and Validation Failures.
* `ReportsView`, `NotificationsPanel`.
* `DemoModeBar` — persistent control strip: scenario selector, start, reset.

**Assessment Failure UX:** Rather than displaying a raw error when generation fails, the UI implements a structured recovery flow: **Assessment Failed → Retry → Switch Provider (if configured) → Continue Manual Review**. The operator must never be blocked from making a Decision simply because the AI failed, reinforcing the platform's human-in-the-loop philosophy.

---

## 7. Backend Architecture

**FastAPI**, structured by domain module.

**7.1 Configuration Strategy**
To avoid hardcoding operational constants in business logic, the backend uses a lightweight configuration strategy (e.g., a `.env` file loaded via Pydantic Settings). This externalizes values such as:

* Active AI provider and model name
* Gas/sensor thresholds
* Retry counts
* Simulator timing
* Feature flags

Keep this intentionally simple; do not introduce distributed configuration systems.

**Database access:** SQLAlchemy 2.x (async) + asyncpg. Schema management: a single `schema.sql` applied on startup/reset.

**WebSocket manager:** one connection registry, one `broadcast(event)` function. No per-user filtering server-side.

---

## 8. Shared Data Models / API Contracts

To prevent frontend/backend contract drift, canonical request/response models, types, DTOs, and shared enums live in a unified `shared/` package accessible to both sides of the repository. Core shapes every engineer should treat as frozen once agreed.

```python
# Canonical shapes defined in shared contracts
class Context(BaseModel):
    id: UUID
    asset_id: UUID
    category: str            
    payload: dict            
    provider: str             
    valid_from: datetime
    valid_until: datetime
    confidence: float

class DerivedFact(BaseModel):
    id: UUID
    asset_id: UUID
    fact_type: str            
    value: bool | float | str
    computed_at: datetime
    source_context_ids: list[UUID]

class Recommendation(BaseModel):
    id: UUID
    text: str
    rationale: str
    disposition: Literal["proposed", "accepted", "rejected"] | None

class Assessment(BaseModel):
    id: UUID
    review_id: UUID
    status: Literal["pending", "generating", "complete", "failed", "superseded"]
    risk_level: Literal["nominal", "elevated", "blocking"]
    summary: str
    recommendations: list[Recommendation]
    derived_fact_ids: list[UUID]
    metadata: AssessmentMetadata

class Decision(BaseModel):
    id: UUID
    review_id: UUID
    assessment_id: UUID
    decided_by: UUID          
    outcome: Literal["approved", "approved_with_conditions", "blocked"]
    recommendation_dispositions: dict[UUID, Literal["accepted", "rejected"]]
    conditions: str | None
    submitted_at: datetime

class Review(BaseModel):
    id: UUID
    asset_id: UUID
    state: Literal["opened", "assessing", "pending_decision",
                    "decided", "escalated", "closed", "reopened"]
    owner_id: UUID
    triggered_by: str          
    created_at: datetime

```

**REST endpoints (grouped):**

| Group | Endpoints |
| --- | --- |
| Reviews | `POST /reviews`, `GET /reviews`, `GET /reviews/{id}`, `POST /reviews/{id}/escalate`, `POST /reviews/{id}/reopen` |
| Context | `POST /context`, `GET /assets/{id}/context` |
| Assessments | `GET /reviews/{id}/assessments`, `POST /reviews/{id}/assessments/retry` |
| Decisions | `POST /reviews/{id}/decisions` |
| Reports | `GET /reviews/{id}/reports`, `GET /reports/{id}` |
| Notifications | `GET /notifications` |
| AI Ops | `GET /ai-ops/summary` |
| Simulator / Demo | `POST /demo/scenarios/{name}/start`, `POST /demo/reset`, `GET /demo/scenarios` |

---

## 9. Database Design

PostgreSQL, one schema. Audit is insert-only by team convention.

| Table | Key columns | Notes |
| --- | --- | --- |
| `assets` | id, name, zone, plant_id | Seeded fixture |
| `workers` | id, name, certifications, department_id | Seeded fixture |
| `departments` | id, name | Seeded fixture |
| `permits` | id, asset_id, worker_ids, window_start, window_end, status | Seeded fixture + simulator-writable |
| `review_types` | id, name | Seeded fixture |
| `incidents` | id, asset_id, description, reported_at, linked_review_ids | Used for post-closure linking & Retrieval stage |
| `regulations` | id, code, title, body_summary, applies_to_category | Seeded fixture; Retrieval source |
| `sops` | id, title, body_summary, applies_to_category | Seeded fixture; Retrieval source |
| `reviews` | id, asset_id, state, owner_id, triggered_by, created_at, closed_at | Written only by the transition service |
| `review_participants` | review_id, worker_id, role, active |  |
| `context_entries` | id, asset_id, category, payload (jsonb), provider, valid_from, valid_until, confidence |  |
| `derived_facts` | id, asset_id, fact_type, value, computed_at, source_context_ids |  |
| `assessments` | id, review_id, status, risk_level, summary, derived_fact_ids, version |  |
| `assessment_metadata` | assessment_id, provider, model, prompt_version, tokens_in, tokens_out, cost_usd, latency_ms, confidence, retrieved_evidence_ids |  |
| `recommendations` | id, assessment_id, text, rationale, disposition |  |
| `decisions` | id, review_id, assessment_id, decided_by, outcome, conditions, submitted_at |  |
| `evidence` | id, review_id, decision_id, frozen_context_ids, frozen_assessment_id, captured_at | Immutable once written |
| `reports` | id, review_id, closure_event_seq, content (jsonb), generated_at |  |
| `notifications` | id, review_id, event_type, summary, recipient_ids, created_at |  |
| `audit_entries` | id, entity_type, entity_id, event_type, actor, payload (jsonb), recorded_at | Insert-only |
| `users` | id, name, role | Seeded demo users, no auth |

---

## 10. Folder Structure

```text
shared/
  schemas.ts          // or python equivalent/generator
  enums.ts
  api_contracts.ts

backend/
  app/
    core/              config.py
    reviews/           routes.py, service.py, state_machine.py, schemas.py
    context/           routes.py, providers/manual.py, providers/simulator.py,
                       derived_facts.py, schemas.py
    assessment/        orchestrator.py, retrieval.py, pipeline.py,
                       providers/openai_compatible.py,
                       providers/ollama.py, providers/mock.py, schemas.py
    decisions/         routes.py, service.py
    reports/           routes.py, generator.py
    notifications/     service.py, templates.py
    audit/             service.py
    simulator/         scenarios/gas_leak.yaml, scenarios/permit_conflict.yaml,
                       scenarios/compound_risk.yaml, engine.py, routes.py
    realtime/          connection_manager.py
    db/                schema.sql, session.py, seed.py
    main.py

frontend/
  src/
    features/
      reviews/         ReviewList.tsx, ReviewDetail.tsx
      digital-twin/    DigitalTwin.tsx, floor_plan_map.json, AssetPanel.tsx
      assessment/      AssessmentPanel.tsx
      ai-ops/          AIOpsDashboard.tsx
      reports/         ReportsView.tsx
      notifications/   NotificationsPanel.tsx
      demo/            DemoModeBar.tsx
    hooks/             useRealtimeEvents.ts
    store/             demoStore.ts
    api/               client.ts
    assets/            plant-floor-plan.svg

```

---

## 11. Implementation Plan

**Ownership by engineer (logical areas, not rigid lanes — expect crossover on Days 6–9):**

| Engineer | Owns |
| --- | --- |
| Eng 1 — Backend Core | Review state machine, Context Engine, Derived Facts, DB schema/seed, Audit |
| Eng 2 — AI/Assessment | Assessment Orchestrator (retrieval decision, provider selection, retries), Mock/Real provider abstractions, structured output validation, AI Observability, AI Ops dashboard |
| Eng 3 — Digital Twin & Frontend Core | SVG floor plan rendering, asset highlighting, evidence side panel, WebSocket client, app shell/routing, Shared Contracts sync |
| Eng 4 — Simulator & Workflow UI | YAML Scenario DSL, Demo Mode, Review/Assessment/Decision screens (incl. Failure recovery UX), Reports, Notifications |

**Day-by-day:**

| Days | Focus |
| --- | --- |
| 1 | Freeze Section 8 shared contracts. Config strategy applied. Skeleton FastAPI + React apps talking to each other over one dummy endpoint. |
| 2–3 | Eng 1: state machine + Context/Derived Facts working headless. Eng 2: AI MockProvider + one real provider wired up. Eng 3: floor plan renders, asset click works against fixture data. Eng 4: one YAML scenario drafted, Review/Decision screens against fixture data. |
| 4–5 | Full pipeline connected end to end: Context → Derived Facts → Assessment → WebSocket → frontend update. Second AI provider (Ollama) wired in. |
| 6–7 | Digital Twin driven by live Assessment/Derived Fact state. All 3 scenarios scripted and triggering real Reviews. Decisions freezing real Evidence. |
| 8 | Demo Mode (reset/replay), Reports, Notifications, AI Ops dashboard wired to real data. |
| 9 | Full run-throughs of all 3 scenarios end to end. Bug bash. Smoke + state machine + schema tests passing. |
| 10 | Polish, demo recording, buffer for the inevitable. |

---

## 12. Demo Scenarios

All three run through the same deterministic Simulator engine via YAML scenario files.

**Gas Leak** — single-signal case. Gas reading climbs past threshold on one Asset → `Elevated Gas` derived → Review opens → Assessment flags elevated risk, recommends monitoring.

**Permit Conflict** — single-signal case. Two overlapping permits are emitted for the same Asset → `Permit Conflict` derived → Review opens → Assessment flags a scheduling conflict, recommends one permit be rescheduled.

**Compound Risk — the signature scenario.** This is built to match the fixed demo sequence directly:

| Step | Context emitted | Derived Fact | Effect |
| --- | --- | --- | --- |
| Plant safe | baseline readings | none active | Digital Twin shows all-clear |
| Gas rises | elevated gas reading | `Elevated Gas` | Asset highlight shifts to elevated |
| Worker enters zone | worker location context | `Zone Occupied` | Asset highlight shifts further |
| Permit activates | permit context, overlapping hazard | `Permit Conflict` | Combination now present |
| — | — | (material change check via `should_reassess`) | Review auto-opens / re-enters Assessing |
| Twin highlights | — | — | Digital Twin shows the affected zone in blocking state |
| AI blocks | — | — | Assessment completes with `risk_level = blocking` |
| Supervisor opens Assessment | — | — | Evidence trace shows exactly which Context/Derived Facts drove the block |

Everything downstream of this table (dashboards, Reports, AI Ops, architecture discussion) is explicitly secondary in the demo video and should not compete with this sequence for engineering time.

---

## 13. Known Trade-offs

| Decision | Why | What it costs |
| --- | --- | --- |
| No plugin framework, only 2-3 providers | 10 days doesn't afford a general adapter layer | Adding a new enterprise provider later means writing the interface implementation *and* proving the abstraction actually generalizes |
| Seeded fixtures, no CRUD/mgmt UI for master data | Removes an entire surface with no demo payoff | Any master data error requires a DB edit, not a UI fix, during the event |
| In-process asyncio task instead of a job broker | No infra to stand up or debug under time pressure | Doesn't survive a process restart mid-assessment; acceptable for a live demo, not for production |
| Single broadcast WebSocket channel | No per-user routing logic to build or debug | Every client receives every event; fine at demo scale, would need real scoping before multi-tenant use |
| Flat/simple audit table, no tamper-evidence | Judges can't see hash-chaining; team convention (no UPDATE/DELETE) gets the same demo-visible integrity | Not actually tamper-proof — acceptable, since that was never the point for this build |
| Static, hand-authored floor plan mapping | No mapping UI to build | Adding a new asset to the twin means editing a JSON file, not clicking a pin — fine for a single fixed plant |
| No PDF export for Reports | Out of scope unless time allows | Reports are viewable in-app only for the demo |
| Compliance Rule versioning omitted | None of the 3 demo scenarios need it | Revisit if a future scenario requires citing a specific rule version |

---

## 14. Future Engineering Hooks

None of this is built during the 10-day build. It's documented here so the seams these decisions already leave are on the record, not rediscovered later.

* **Evaluation Mode** — `assessment_metadata` (Section 5.4.1) already carries everything a batch eval run would need (`prompt_version`, `provider`, `model`, `retrieved_evidence_ids`, `confidence`). Running Derived Fact fixtures through the Orchestrator and diffing output is a script against existing tables, not a new subsystem.
* **Prompt Registry** — `prompt_version` is already a plain string on every Assessment call. Today it's hand-bumped in code; a registry would just be a table mapping that string to stored prompt text and a diff view. No templating engine needed now.
* **Model Registry** — `AIProvider` (Section 5.4) is already an interface with three implementations. A registry is a config table of provider/model pairs plus which one is "active" — the abstraction doesn't change, only how it's selected.
* **Additional Context Providers** — `ContextProvider` (Section 5.2) is already a two-line Protocol implemented by Manual Input and Simulator. A future SAP/SCADA feed implements the same Protocol; nothing else in the pipeline needs to know it exists.
* **Enterprise Integrations** (SSO, per-tenant scoping, real audit tamper-evidence) — explicitly out of scope. Section 2's single-tenant, no-auth, broadcast-everything decisions are what let four people build this in 10 days; multi-tenant support is a different system, not a flag to flip.

None of these are MVP features, and none should get engineering time before Day 10. They're listed because the architecture already happens to leave room for them, not as a backlog.

---

Treat Sections 8 and 9 as frozen the moment all four engineers have seen them — everything else in this document can flex if reality on Day 4 disagrees with it, but a contract change after that point should be a conversation, not a silent edit.