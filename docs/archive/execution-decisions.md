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

## Architecture is frozen — with one deliberate pivot

Architecture stayed frozen through implementation **except** the pre-demo agentic pivot:

- Assessment generation is now a **LangGraph multi-agent StateGraph** (not a single synthesis call)
- Deterministic rules remain as **tools** (grounding for BLOCK)
- Knowledge graph (NetworkX) + Spatial Agent for radius co-occurrence
- Per-source plant simulators (SCADA / PTW / Maintenance / Workforce) coordinated by an Orchestrator Sim
- LangSmith optional for AI Ops traces

The review state machine, Decision outcomes, Manual Assessment fallback, and evidence freeze are unchanged.

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
| **Rules (deterministic tools)** | Produce facts — thirteen rules spanning process, people, and environment. Agents call these; they do not invent safety facts. |
| **LangGraph agents** | SCADA / Permit / Maintenance / Workforce / Spatial / Shift Handover run pre-verdict (their facts reach the gate) → Orchestrator fuses into compound verdict → Incident Pattern enriches on elevated/blocking |
| **Knowledge graph** | Asset–permit–zone relationships + spatial radius (NEAR / ABOVE) |
| **Retrieval (hybrid)** | RAG (pgvector) + quality gate + deterministic SQL fallback for regs / SOPs / incidents |
| **LangSmith** | Optional per-agent traces, latency, tokens, cost (AI Ops) |

**Product value:** multi-agent synthesis of siloed plant systems — not replacing deterministic engineering logic.

**Demo cue:** show the **Brain** panel streaming `agent.step` events, then click the asset for spatial KG links + incident echo.

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
2. **Digital Twin reasoning trace** (click asset → see why — including Retrieved References)
3. **Decision + Evidence freeze + Report close**

Cut before cutting the above: Escalation, Reopened paths, second AI provider, AI Ops, Notifications.

**RAG cut order:** Deterministic retrieval is the guaranteed floor. Disable RAG via `RAG_ENABLED=false` or skip threshold tuning before deleting fallback SQL — never ship hollow/unused RAG; either show path+score in the trace or fall back visibly.

---

## Checklist: what we already pass

- Real, cited problem (VSP, DGFASLI, FICCI)
- Sits above existing systems; does not replace them
- AI recommends; humans decide; override is first-class
- Deterministic rules before LLM; hybrid retrieval with honest fallback
- More than PS karaoke — thirteen facts + graded RAG, not only the three example signals
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
- Hybrid retrieval shape (RAG primary + quality gate + deterministic fallback) and the expanded derived-fact catalog (thirteen MVP facts across three floors) — locked pre-build amendment; do not reopen into agentic tool-calling
- Multi-floor Digital Twin (ground / first / second static SVGs + floor-tab switcher) and Dual Demo Mode (scripted YAML + configurable Random Mode) — presentation/ops enrichment; retrieval architecture unchanged

---

## Wow moments (backlog — develop during build)

Captured after comparing against AgriBloom. Core architecture stays; these are **demo/presentation moments** to layer on during implementation — several are now supported by the graded RAG + expanded-facts amendment.

**Principle:** Each moment should prove a *different claim* in seconds (not "we have more features"). AgriBloom pattern: Kannada UI = built for real user; voice = accessibility; orange leaf = handles untrained cases; compliance block = AI can't override safety. **Ours:** not PS karaoke + retrieval that survives "show me RAG."

### Candidate moments

| # | Moment | Claim it proves | Build cost | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Compound risk build-up** (hero) | No single system saw this; we did | Already planned | Protect under pressure |
| 2 | **Multi-system blindness contrast** | SCADA / PTW / Maximo all green — still deadly | Low | Cosmetic strip over existing facts |
| 3 | **Semantic incident echo** | Pattern matches a prior near-miss / VSP-style failure via RAG | Med | Seed matching chunks; show path=`rag` + score in trace |
| 4 | **Instant audit reconstruction** ("6 months later") | Weeks of log-pulling → seconds | Low–med | Evidence freeze + report — make the time-jump visceral |
| 5 | **Human override with reason** | AI recommends; human truly decides | Low | Decision already supports this |
| 6 | **Assessment failure → Manual Assessment** | Even when AI dies, workflow + audit survive | Already planned | Show deliberately (failure → feature) |
| 7 | **Live regulation citation** | Grounded in OISD / Factory Act, not vibes | Low–med | Cite by name; path + score visible |
| 8 | **Live reassessment / supersede** | Picture changed → analysis changed | Med | `should_reassess` already exists |
| 9 | **Plant-native language** | Written for Rajesh, not a data scientist | Prompt polish | Copy quality, not a localization system |
| 10 | **Retrieval fallback honesty** | RAG soft — system still cites via deterministic path | Already in design | Frame as reliability, not failure |
| 11 | **Beyond-PS fact flash** | Incomplete isolation / SIMOPS / cert — not only the three examples | Low–med | Optional fourth scenario or context step |

### Leading candidates for demo (prefer these)

- **A — Multi-system blindness → compound block** — your "compliance gate": every silo says fine; SOP Opera says BLOCK
- **B — Semantic incident echo** — emotional kill shot; assessment cites a matching prior near-miss via RAG with visible score
- **C — Live regulation citation** — Named OISD / Factory Act clause in the References node (not vibes)
- **D — Instant audit reconstruction** — "6 months later, investigator asks what we knew" → frozen evidence + report
- **E (optional) — Manual Assessment path or RAG→deterministic fallback** — prove resilience when AI or retrieval soft-fails

### Possible 6-minute shape (draft — not locked)

```
0:00  Twin, nominal day
0:40  Multi-system strip — everything green
1:15  Compound Risk starts; gas rises
1:50  Worker + permit → BLOCK (Moment A)
2:20  Click asset → reasoning trace
2:50  Semantic incident echo + VSP tie-in (Moment B) — path=rag, score visible
3:20  Regulation cited by name (Moment C) → recommend Block
3:50  Supervisor records Blocked → evidence frozen
4:20  Optional: AI fail → Manual Assessment OR show fallback path (Moment E)
4:50  "6 months later" → instant audit + report (Moment D)
5:30  Mention six facts / SIMOPS briefly if asked
6:00  Impact numbers + tagline
```

### Small builds these imply

- Nominal / happy-path YAML scenario
- Multi-system contrast strip UI
- Seed 1–2 historical incidents matching the compound pattern **plus chunks in `knowledge_chunks`**
- Crisp closed-review → evidence + report view
- One regulation shown by name in the assessment with retrieval path/score
- Threshold tune so Compound Risk incident echo reliably grades `good`
- PDF export for reports (optional; AgriBloom rated this high)
- `PRESENTATION_GUIDE.md` + `BENCHMARKS.md` as deliverables

### Do **not** add to catch "wow" (stubs / slides only)

- Full industry rule-authoring UI
- WhatsApp / contact integration
- Freeform LLM chat about plant risk
- Google-Earth multi-plant canvas
- Live SCADA adapters
- Hollow RAG that is never shown in the UI

Team size (4) justifies more *depth and polish* than AgriBloom's solo path — more moments and artifacts — not a return to platform sprawl.

---

*This document is the team's shared reference for pitch, demo, and UX priorities. Update only when presentation decisions change — not when implementation details evolve.*
