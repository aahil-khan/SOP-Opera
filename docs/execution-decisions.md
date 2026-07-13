# Execution Decisions & Demo Guide
### Operational Review Platform — Post-Review Reference

**Status:** Frozen | **Date:** July 2026  
**Purpose:** Capture product presentation, demo choreography, and positioning decisions from the hackathon checklist review. This doc does not change architecture — it records how we execute and present what is already designed.

**Authority:** Architecture and implementation remain defined by the [Technical Design Spec](./Technical%20Design%20Spec.md). Earlier design-phase docs live in [archive/](./archive/) for reference only.

---

## What changed in our thinking

The checklist review confirmed the architecture is sound. Remaining work is **implementation, UX polish, and demo choreography** — not redesign.

The discussion shifted from *"what should we build?"* to *"how do we present and execute it well?"*

---

## Architecture is frozen

No architectural changes based on the review.

Going forward, only **implementation details** that naturally emerge during the build are in scope. The TDS state machine, Assessment pipeline, Digital Twin, Context Provider interface, and Manual Assessment fallback are settled.

---

## 1. One primary user

**Protagonist (hackathon):** Shift Supervisor / Area In-Charge.

**Secondary:** HSE / Safety Officer — consumes reports, trends, and escalated reviews *after* the operational decision is made.

All demo, video, and presentation material follows the Shift Supervisor.

---

## 2. Workflow positioning

Do **not** present SOP Opera as another application people must remember to open.

**Positioning:**

> This operational decision already exists today. It currently happens through paper permits, phone calls, WhatsApp, SCADA screens, and operator experience. SOP Opera provides a structured, explainable, and auditable Operational Review for a decision that already exists.

---

## 3. Why AI? (prepare this answer)

The most important technical question judges will ask.

| Layer | Responsibility |
| --- | --- |
| **Rules (deterministic)** | Produce facts: elevated gas, permit conflict, worker in hazardous zone |
| **LLM** | Does **not** detect these facts |
| **LLM** | Synthesizes facts + historical incidents + regulations + SOPs → operational reasoning, recommendations, explainable assessment, decision record |

**Product value:** synthesis and explainability — not replacing deterministic engineering logic.

Make this distinction **explicit during the demo**, not only in Q&A.

---

## 4. Demo flow (judge interaction)

First interaction should happen almost immediately. Do not open with architecture or feature tours.

```
1. Start Compound Risk scenario
2. Watch Digital Twin update live
3. Click the highlighted asset
4. Assessment opens (reasoning trace visible)
5. Supervisor records Decision
   ─── only after this ───
6. Evidence frozen → Report → audit record (story close)
7. Architecture / supporting features (if time or asked)
```

---

## 5. First screen

The application opens **directly on the Digital Twin in Demo Mode**.

The Operational Review list is secondary navigation — not the landing experience.

**Goal:** The first 10–15 seconds communicate value visually without narration.

---

## 6. Enterprise integration story

The demo exercises **Manual Input** and **Simulator** through the same `ContextProvider` interface.

Enterprise integrations (SAP, SCADA, Maximo, PTW) are **future Context Providers** — not hackathon adapters.

**Explain the seam; do not pretend to integrate enterprise systems during the demo.**

---

## 7. Business story (presentation)

| | |
| --- | --- |
| **Customer** | Plant Operations / EHS |
| **Workflow change** | Every critical permit receives a short Operational Review before approval |
| **Value** | Fewer near-misses · Better operational decisions · Explainable audit trail · Dramatically faster incident reconstruction |

---

## 8. Demo scope (what to show vs. hide)

**Primary surfaces (main flow):**

- Digital Twin
- Assessment
- Decision

**Supporting material (not the main flow):**

- AI Ops dashboard
- Reports (except closing beat)
- Notifications
- Review list

Keep the demo focused. Cut to supporting features only when asked or for the closing audit-record beat.

---

## 9. Closing the story

Do not stop immediately after the Assessment. End with a complete arc:

```
Decision
  ↓
Evidence frozen
  ↓
Professional Report generated
  ↓
Complete audit record
```

This gives judges a business outcome, not just a technical moment.

---

## Scope under pressure

If time is lost, protect in this order:

1. **Compound Risk scenario** end-to-end
2. **Digital Twin reasoning trace** (click asset → see why)
3. **Decision + Evidence freeze + Report close**

Cut before cutting the above: Escalation, Reopened paths, second AI provider, AI Ops, Notifications.

---

## Checklist: what we already pass

- Real, cited problem (VSP, DGFASLI, FICCI)
- Sits above existing systems; does not replace them
- AI recommends; humans decide; override is first-class
- Deterministic validation layer before LLM
- Differentiated from generic dashboard / chatbot / auto-approval products
- One memorable interaction: Compound Risk + reasoning trace on the twin
- Buildable in 10 days with documented trade-offs

---

## What we are not revisiting

- TDS state machine (`Opened → Assessing → Pending Decision → Decided → Closed`)
- Decision outcomes (`Approved`, `Approved with Conditions`, `Blocked`)
- Manual Assessment fallback (every Decision backed by an Assessment)
- Context vs Evidence terminology
- Connected Mode, compliance versioning, audit tamper-evidence, multi-provider framework — deliberate hackathon simplifications

---

*This document is the team's shared reference for pitch, demo, and UX priorities. Update only when presentation decisions change — not when implementation details evolve.*
