# Architecture Decisions (ADR)

Operational Review Platform

These are the major architectural decisions made during product design before implementation began. They explain *why* the system looks the way it does.

This document is intentionally short. The TDS describes **how** the system is built. This document explains **why**.

---

# ADR-001 — Operational Review is the product

Decision

The product is centered around Operational Reviews.

Every Assessment, Recommendation, Report, Notification and Decision exists because an Operational Review exists.

Why

The challenge is about improving operational decision making, not building another dashboard or AI assistant.

Consequences

- One clear workflow
- Strong product identity
- Easy demo narrative

---

# ADR-002 — AI recommends. Humans decide.

Decision

The AI never performs operational actions.

It only generates Assessments and Recommendations.

Only an authorized human records a Decision.

Why

Industrial environments require accountability.

The AI assists decision makers rather than replacing them.

Consequences

- Human-in-the-loop
- Explainable recommendations
- Better enterprise acceptance

---

# ADR-003 — Native First. Connected Better.

Decision

The platform functions without enterprise integrations.

Manual Context input is sufficient.

SCADA, IoT, SAP and other systems improve evidence quality but are optional.

Why

Plants have different levels of digital maturity.

The product should remain usable regardless of integration availability.

Consequences

- Demo independent of external software
- Easier adoption
- Progressive integration strategy

---

# ADR-004 — Two Context Providers only

Decision

The MVP implements exactly two Context Providers:

- Manual Input
- Simulator

Why

A generic integration framework provides little demo value while consuming significant engineering time.

Consequences

Future providers implement the same interface.

No plugin framework is built during the hackathon.

---

# ADR-005 — Deterministic Context before AI

Decision

Business rules convert raw Context into Derived Facts before AI is invoked.

Examples

Gas > Threshold

↓

Elevated Gas

Permit overlap

↓

Permit Conflict

Worker inside hazardous zone

↓

Zone Occupied

Why

LLMs reason better over structured facts than noisy telemetry.

Consequences

- Better explainability
- More predictable behaviour
- Smaller prompts
- Lower cost

---

# ADR-006 — Deterministic Retrieval

Decision

The Assessment Orchestrator decides whether additional evidence should be retrieved.

The LLM never chooses tools.

Possible retrieval sources include:

- Regulations
- Historical Incidents
- SOPs

Why

The decision is deterministic and auditable.

Consequences

Simple architecture without autonomous agent loops.

---

# ADR-007 — Provider abstraction

Decision

AI providers implement a common interface.

Initial providers:

- OpenAI Compatible
- Ollama
- Mock Provider

Why

Supports privacy requirements, local deployment and development without API keys.

Consequences

Provider switching requires configuration rather than architectural changes.

---

# ADR-008 — Structured outputs are mandatory

Decision

Every Assessment must satisfy a schema.

Responses are validated.

One retry is allowed.

Failures remain visible.

Why

Reliability is more important than fluent text.

Consequences

The frontend always receives predictable objects.

---

# ADR-009 — Assessment Orchestrator owns the pipeline

Decision

Exactly one component coordinates Assessment generation.

Responsibilities include:

- reassessment decisions
- retrieval decisions
- provider selection
- retries
- validation
- persistence
- observability

Why

Pipeline ownership belongs in one place.

Consequences

No duplicated orchestration logic.

---

# ADR-010 — Digital Twin is evidence visualization

Decision

The Digital Twin is not a plant simulator.

It visualizes plant state and Assessment evidence.

Why

The simulator generates Context.

The twin explains why the AI reached its conclusion.

Consequences

Engineering effort focuses on interaction rather than graphics.

---

# ADR-011 — Simulator exists for demonstrations

Decision

The Simulator emits Context events through the same interface used by Manual Input.

Scenario behaviour is defined using YAML.

Why

The simulator should exercise the real product rather than bypass it.

Consequences

Demo scenarios remain reusable.

---

# ADR-012 — Single backend

Decision

One FastAPI application.

One PostgreSQL database.

One React frontend.

Why

Microservices provide no value during a 10-day hackathon.

Consequences

Lower operational complexity.

Faster iteration.

---

# ADR-013 — WebSockets over polling

Decision

Assessment completion, notifications and Digital Twin updates use WebSockets.

Why

The platform should feel alive.

Consequences

Better demo experience with minimal complexity.

---

# ADR-014 — Configuration over hardcoding

Decision

Operational thresholds, AI provider selection and feature flags live in configuration.

Why

Business rules change more often than code.

Consequences

Simpler experimentation.

Cleaner implementation.

---

# ADR-015 — AI observability is part of the product

Decision

Every Assessment records:

- provider
- model
- prompt version
- tokens
- latency
- estimated cost
- confidence

Why

Enterprise AI requires visibility into quality and operational cost.

Consequences

Supports future evaluation and optimisation without redesign.

---

# ADR-016 — Evidence is frozen at decision time

Decision

When a Decision is recorded, the supporting Context and Assessment are frozen.

Why

Reports should always reflect the information available when the decision was made.

Consequences

Strong audit trail.

Reproducible reports.

---

# ADR-017 — Seeded master data

Decision

Workers, Assets, Departments and Review Types are fixtures.

No CRUD interfaces are built.

Why

Management interfaces add little demo value.

Consequences

Development effort remains focused on operational workflow.

---

# ADR-018 — Architecture optimizes for implementation

Decision

Whenever architectural elegance conflicts with hackathon delivery, implementation speed wins unless it weakens either:

- Operational Assessment Pipeline
- Digital Twin

Why

A working product is more valuable than a perfect architecture.

Consequences

Intentional simplifications are documented rather than hidden.

---

# ADR-019 — Production mindset without production complexity

Decision

The MVP intentionally includes engineering practices such as:

- structured outputs
- provider abstraction
- AI observability
- configuration
- deterministic pipelines
- shared contracts

while intentionally excluding:

- microservices
- Kubernetes
- distributed messaging
- plugin frameworks
- event sourcing
- complex infrastructure

Why

The goal is to demonstrate sound software engineering without spending engineering effort on infrastructure that does not improve the product.

Consequences

The architecture remains understandable, maintainable and realistic to build within the hackathon timeline.