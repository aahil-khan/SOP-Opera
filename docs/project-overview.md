# What We Are Building
### SOP Opera — Plain-language guide for the team

This document explains the entire project simply. It is for **understanding only** — not the implementation spec. When you need to build something, use the [Technical Design Spec](./Technical%20Design%20Spec.md). When you need demo/pitch decisions, use [Execution Decisions](./execution-decisions.md).

---

## The problem in one paragraph

Large industrial plants already have lots of software: SCADA for sensors, SAP/Maximo for maintenance, PTW systems for permits, incident databases, and more. Each system knows its own slice of the plant. None of them reliably tell a supervisor **everything relevant at once** when they are about to authorize dangerous work.

So today, the go/no-go call often happens like this: a supervisor checks a permit, glances at a SCADA screen, relies on memory and phone calls, and approves work if nothing *obviously* looks wrong. Compound risks — gas reading + overlapping permit + worker in the wrong zone — can all be true at the same time without anyone connecting them before work starts.

Real incidents (like the Visakhapatnam Steel Plant coke oven explosion in 2025) have shown that warning signals often **existed in the plant's own systems** but never reached the person making the decision in time.

**The problem is not missing data. It is missing synthesis at the exact moment a human must decide.**

---

## Who we are solving it for

**Primary user (our protagonist):** Shift Supervisor / Area In-Charge.

This is the person who authorizes high-risk work on a shift — hot work, confined space entry, isolation removal, and similar activities. They are accountable. They are under time pressure. They need a fast, honest picture — not another dashboard to babysit.

**Secondary user:** HSE / Safety Officer. They care about trends, audit trails, and escalated cases — *after* the supervisor has made the operational call. They are not the demo protagonist.

**We are not building for:** data scientists, plant-wide monitoring operators, or executives staring at traffic-light dashboards.

---

## What SOP Opera is

**One sentence:** SOP Opera is an **agentic industrial safety intelligence layer** — a LangGraph multi-agent brain over plant context (sensors, permits, maintenance, workforce) that detects compound risk, cites historical near-misses, and helps a shift supervisor run a structured, explainable **Operational Review** before authorizing high-risk work.

**Important framing:** We are not inventing a new decision. Supervisors already make this call every day — via paper, phone, WhatsApp, SCADA, and experience. We are making that decision **structured, explainable, and auditable** — with a visible multi-agent reasoning stream inspired by Unified Operations Centers.

**What we are not:** A SCADA replacement, an ERP, a freeform chatbot, an auto-approval system, or a system that controls plant equipment.

---

## The three things that matter (never blur these)

Everything in the product revolves around three objects with three owners:

| Object | Owner | What it is |
| --- | --- | --- |
| **Operational Review** | The platform | The case file. Tracks one high-risk activity from open to close. |
| **Operational Assessment** | The AI (or supervisor, if manual) | The structured analysis: what was found, why it matters, what is recommended. |
| **Decision** | The human supervisor | The binding call: Approved, Approved with Conditions, or Blocked. |

**Rule:** The AI never decides. The human never edits the AI's assessment — they respond to it with a decision. The platform never executes physical work.

---

## What happens step by step (the hero workflow)

1. **Something triggers a review** — e.g. a hot-work permit for a pipeline section near a vessel.

2. **Context comes in** — sensor readings, permit status, worker location, historical incidents, regulations, SOPs. In the hackathon this comes from **Manual Input** and a **Simulator** (same interface a real SCADA/SAP feed would use later).

3. **Rules turn context into facts** — plain code, not AI. Six rules in total — not just the three example signals from the problem statement:
   - Gas above threshold → *Elevated Gas*
   - Overlapping permits → *Permit Conflict*
   - Worker in hazardous zone → *Zone Occupied*
   - LOTO / isolation not confirmed → *Incomplete Isolation*
   - Adjacent hot-work + confined-space conflict → *Simultaneous Ops*
   - Assigned worker cert missing or expiring → *Certification Expiring*

4. **AI produces an Assessment** — the LLM does **not** detect those facts. It **semantically retrieves** relevant regulations / SOPs / past incidents (RAG with a rules-based fallback if retrieval quality is weak), then **synthesizes** them into explainable reasoning and recommendations.

5. **Supervisor reviews and decides** — Approve, Approve with Conditions, or Block. They can accept or reject individual recommendations. Their authority is real.

6. **Evidence is frozen** — exactly what context and assessment the decision relied on is saved permanently.

7. **Review closes** — a report is generated. That record helps the next review and makes incident reconstruction far faster.

If AI generation fails, the supervisor can create a **Manual Assessment** and still record a decision. Every decision must be backed by *some* assessment.

---

## The one thing people should remember

**The Digital Twin reasoning trace.**

A simple 2D floor plan of the plant. When risk builds up, assets highlight. The supervisor clicks the affected asset and sees a clear chain:

```
Asset → Context → Derived Facts → Regulations / History → Assessment → Recommendations → Decision
```

This is not decoration. It answers: **"Why did the system say this?"** — live, driven by real backend state.

The signature demo is **Compound Risk**: gas rises, a worker enters a hazardous zone, a permit activates — three signals combine — the twin shifts to blocking — the supervisor clicks through and sees exactly which facts drove the block.

---

## Why AI at all? (say this clearly)

Judges will ask: *"Couldn't rules or SQL do this?"*

**Yes — for hard facts.** Deterministic rules (exposed as agent **tools**) produce grounded facts. A BLOCK verdict must be backed by at least one rule output.

**LangGraph multi-agent AI does the rest:**

1. **Source agents** (SCADA, Permit, Maintenance, Workforce) interpret their silo and emit local risk
2. **Spatial Agent** queries a plant knowledge graph for hot-work within Xm of a gas spike (incl. vertical adjacency)
3. **Incident Pattern Agent** RAG-echoes prior near-misses (path + score visible)
4. **Orchestrator** fuses signals into a compound verdict + assessment
5. **Predictive Trend Agent** projects near-term threshold crossings from telemetry trajectories
6. **Shift Handover Agent** drafts briefs for the incoming supervisor
6. **LangSmith** (optional) traces every agent/LLM call for AI Ops

**The product value is not "AI detected gas."** The product value is **"independent plant systems don't talk — our agents do, live, and leave an audit trail."**

---

## What we are building in the hackathon (10 days, 4 engineers)

| Piece | What it does |
| --- | --- |
| **Backend** | FastAPI + PostgreSQL (+ pgvector). Review state machine. Context engine. Six derived facts. Assessment pipeline. |
| **Frontend** | Next.js app. Opens on **Digital Twin in Demo Mode**. Assessment panel. Decision flow. |
| **Simulator** | YAML scenarios replay fake plant events (gas leak, permit conflict, compound risk). |
| **AI** | Hybrid retrieval (RAG + quality gate + deterministic fallback). Mock for dev; OpenAI-compatible / Ollama for demo. Structured output, one retry, then fail visibly. |
| **Realtime** | WebSocket broadcasts so the twin and UI update live. |

**Intentionally simplified for the hackathon:** no SAP/SCADA adapters (simulator stands in), no auth/SSO, no Kubernetes, no tamper-proof audit chain, seeded plant data only.

**Architecture is frozen for coding** (with the deliberate pre-build amendment: six facts + hybrid retrieval — see TDS). Remaining work is implementation, polish, and demo choreography.

---

## The demo (how we show it)

**Open on:** Digital Twin + Demo Mode bar. Not the review list.

**Flow:**
1. Start Compound Risk scenario
2. Watch the twin update (no narration needed for first 10–15 seconds)
3. Click the highlighted asset → reasoning trace opens
4. Supervisor records **Blocked** (or Approved with Conditions)
5. Close the story: Evidence frozen → Report → audit record
6. Only then: architecture or supporting features if asked

**Keep on screen during demo:** Digital Twin, Assessment, Decision.

**Keep hidden unless asked:** AI Ops dashboard, notifications, review list.

---

## What we are deliberately not building

- Plant-wide risk score / traffic-light dashboard
- Auto-approval below a confidence threshold
- General-purpose safety chatbot
- CCTV worker surveillance
- Live 3D plant twin / geospatial heatmap
- Replacing SAP, Maximo, or SCADA

These were considered and rejected. A focused product beats a feature buffet.

---

## How the docs fit together

| Document | Use it when you need… |
| --- | --- |
| **This doc** | Quick understanding of the whole project |
| [Implementation Guide](./implementation-guide.md) | Deep dive — architecture, features, final product, frozen decisions |
| [Technical Design Spec](./Technical%20Design%20Spec.md) | How to build it (source of truth for code) |
| [Execution Decisions](./execution-decisions.md) | Demo flow, pitch, UX priorities |
| [Archive](./archive/) | Earlier design-phase docs (PRD, domain model, ADRs, checklist) — reference only |

---

## Honest notes: winner advice vs. our project

The last winner emphasized: clear user + problem + gap + simple working demo + one memorable feature. No AI buzzword soup.

**Where we align well:**
- Clear user (Shift Supervisor)
- Real, painful problem with cited incidents
- Existing tools don't do cross-system synthesis at decision time
- One memorable feature (reasoning trace on Digital Twin)
- Technically sound architecture (rules before AI, human always decides)
- Focused scope with explicit "not building" list

**Watch-outs (not blockers, but be deliberate):**

| Risk | Why | What to do |
| --- | --- | --- |
| **Feature creep in the demo** | TDS includes AI Ops, Reports, Notifications, Escalation, multiple AI providers | Demo only the twin + assessment + decision. Everything else is backup. |
| **Looking like an "AI product"** | Observability dashboard, multiple providers, structured output pipeline | Talk about the **supervisor's decision**, not the AI stack. Show AI only inside the reasoning trace. |
| **Complexity vs. "simple demo"** | State machine, WebSockets, Derived Facts, Manual Assessment fallback | The *user journey* must feel simple even if the backend is solid. One scenario, one screen, one click. |
| **Integration gap** | No real SAP/SCADA in demo | Explain the Context Provider seam in one sentence; don't apologize or over-slide it. |
| **10-day pressure** | A lot for 4 engineers | Protect Compound Risk end-to-end above all else. Cut AI Ops and polish before cutting the twin trace. Deterministic retrieval is the floor — cut RAG last. |

None of these require architecture changes. They require **discipline in what we show and how we talk about it.**

---

## The story in 30 seconds (for rehearsal)

> Shift supervisors at industrial plants already decide whether dangerous work can proceed — using permits, memory, and whatever happens to be on screen. The data often exists across SCADA, maintenance systems, and PTW software, but nobody synthesizes it at decision time. SOP Opera runs a structured Operational Review: rules surface facts (more than the textbook three), AI retrieves matching history and regulations then explains what they mean together, and the supervisor makes the call. In our demo, three risks combine on a live plant map — the supervisor clicks the asset, sees exactly why work should stop (including a cited prior incident), records the decision, and leaves a complete audit trail. We're not replacing plant systems. We're making the decision that already happens every day visible, explainable, and defensible.

---

*Read [Project Overview](./project-overview.md) first. Use this for the full picture. Build from the TDS. Demo from Execution Decisions.*
