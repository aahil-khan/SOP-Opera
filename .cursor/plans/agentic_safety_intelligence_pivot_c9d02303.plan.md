---
name: Agentic Safety Intelligence Pivot
overview: Transform SOP Opera's thin "rules + one synthesis call" intelligence layer into a visible multi-agent compound-risk brain backed by a knowledge graph, while keeping the working Digital Twin, review/decision/evidence workflow, RAG corpus, and DB. Split the monolithic simulator into per-source sims plus an orchestrator sim that map 1:1 onto the agents, and surface a live agent-reasoning stream, incident echo, and generative shift-handover as headline AI features.
todos:
  - id: agent-core
    content: "Create backend/app/agents/ package: define a LangGraph StateGraph whose nodes are the agents plus shared AgentState. Use graph.astream_events to forward each agent's reasoning step to the existing WebSocket as AgentStep events. Rewire assessment/pipeline.py + orchestrator.py so the asyncio worker invokes the compiled LangGraph run instead of the single synthesis call. Agents use LangChain chat models (langchain-openai / langchain-ollama) so LangSmith traces them automatically."
    status: completed
  - id: rule-tools
    content: Wrap the 13 deterministic rules in context/derived_facts.py as callable agent 'tools' so agents ground conclusions in hard facts; enforce that any BLOCK verdict is backed by a deterministic rule output.
    status: completed
  - id: source-agents
    content: Implement source/monitoring agents (SCADA/Sensor, Permit/PTW, Maintenance, Workforce/Zone). Each interprets its context slice, calls rule-tools, and emits reasoned observations + local risk signals with LLM narration.
    status: completed
  - id: knowledge-graph
    content: Build backend/app/graph/ knowledge graph (networkx) from Postgres entities + coordinates in frontend/lib/floor_plan_map.json. Provide spatial-radius and relationship queries; expose a serializable graph for the frontend.
    status: completed
  - id: spatial-orchestrator
    content: Implement the Spatial Agent (queries KG for radius/temporal co-occurrence, e.g. hot-work permit within Xm of a gas spike) and the Orchestrator Agent that fuses all agent signals into a compound-risk verdict, severity, and the final assessment (replacing the current single synthesis).
    status: completed
  - id: incident-echo
    content: "Implement the Incident Pattern Agent: reuse existing pgvector RAG to surface 'this matches a prior near-miss / VSP-style incident', with retrieval path + score, wired into the assessment + reasoning trace."
    status: completed
  - id: simulator-split
    content: Refactor backend/app/simulator/ into independent per-source simulators (scada, ptw, maintenance, workforce) plus an orchestrator sim that coordinates them to build a realistic compound scenario; keep the same context-ingest seam.
    status: completed
  - id: shift-handover
    content: "Implement the Generative Shift-Handover Agent: summarize the last N hours of events/context into a safety brief; add backend endpoint + a frontend surface."
    status: completed
  - id: frontend-brain
    content: Build the live Agent Reasoning Stream ('Brain') panel in the frontend, driven by the streamed AgentStep WebSocket events, integrated with the Digital Twin so the compound verdict builds up visibly as agents fire.
    status: completed
  - id: frontend-kg-viz
    content: Visualize the knowledge graph (nodes/edges + spatial link that triggered compound risk) inside the reasoning trace / asset drawer, and surface the shift-handover brief.
    status: completed
  - id: config-reliability
    content: Configure LangChain chat models (paid API primary + Ollama fallback), per-agent retries/timeouts, and demo-safety guards so the multi-agent run is snappy and rehearsable; update docs to reflect the pivot away from the frozen anti-agentic decision.
    status: completed
  - id: langsmith-aiops
    content: "Wire LangSmith tracing (LANGCHAIN_TRACING_V2 / API key / project env) so every agent run is captured. Rebuild the AI Ops story on LangSmith: per-agent latency/token/cost, run traces, and replay; keep the in-app /ai-ops cards as a lightweight summary (optionally fed from the LangSmith API) and link/screenshot the LangSmith project for the demo."
    status: pending
isProject: false
---

# Agentic Safety Intelligence Pivot

## Why this pivot

This is an *AI* hackathon whose suggested tech lists **Agentic AI / Multi-Agent Systems first**, and whose flagship example ("Compound Risk Detection Engine") is explicitly a multi-agent system. The current design deliberately did the opposite: 13 deterministic rules do all detection, one LLM call only summarizes, and [`docs/execution-decisions.md`](docs/execution-decisions.md) even locks it as "do not reopen into agentic tool-calling." We hit ~1.5 of 6 suggested techs. The fix is **not a rebuild** — the twin, state machine, review/decision/evidence flow, pgvector RAG, and simulator are the right substrate. We replace the *intelligence layer* with a real, visible multi-agent brain and let everything else become its stage.

## Target architecture (evolve, keep substrate)

```mermaid
flowchart LR
  subgraph sims [Source simulators]
    S1[SCADA sim] --> ING[Context ingest]
    S2[PTW sim] --> ING
    S3[Maintenance sim] --> ING
    S4[Workforce/Zone sim] --> ING
    ORCHSIM[Orchestrator sim coordinates compound scenario] -.drives.-> S1 & S2 & S3 & S4
  end
  ING --> AG
  subgraph AG [Multi-agent brain - LangGraph StateGraph]
    A1[SCADA Agent] --> ORCH[Orchestrator Agent]
    A2[Permit Agent] --> ORCH
    A3[Maintenance Agent] --> ORCH
    A4[Spatial Agent -> queries KG] --> ORCH
    KG[(Knowledge Graph: asset-permit-worker-zone + radius)] --- A4
    RULES[13 deterministic rules = tools] -.grounding.-> A1 & A2 & A3 & ORCH
    ORCH --> IE[Incident Pattern Agent RAG echo]
    ORCH --> VERDICT[Compound risk verdict + assessment]
  end
  AG -.traces.-> LS[LangSmith - AI Ops]
  VERDICT --> WS[WebSocket]
  WS --> TWIN[Digital Twin + live Agent Reasoning Stream]
```

**Grounding principle (keep the trust story):** agents reason, but hard facts (gas > threshold, permit overlap, isolation state) come from the existing deterministic rules exposed as **tools**. A BLOCK verdict must be backed by a deterministic rule output, so the AI reasons but never fabricates a safety fact. This is our answer to "how do we trust the agents."

## Key decisions (baked in; flag to override)

- **Orchestration:** **LangGraph** `StateGraph` — each agent is a node over a shared `AgentState`; conditional edges let the Orchestrator route to the Incident Pattern / shift-handover agents. The existing asyncio worker in [`backend/app/assessment/orchestrator.py`](backend/app/assessment/orchestrator.py) invokes the compiled graph and forwards `astream_events` steps to the existing WebSocket broadcast. Recognized framework + native streaming, no bespoke orchestration to maintain.
- **Observability / AI Ops:** **LangSmith** — automatic tracing of every agent/LLM call (latency, tokens, cost, run replay). This replaces the SQL-aggregate AI Ops story; the in-app [`/ai-ops`](frontend/app/ai-ops/page.tsx) cards stay as a light summary, LangSmith is the deep view for Q&A/demo.
- **LLM access:** LangChain chat models — `langchain-openai` (paid API, primary for demo) with `langchain-ollama` offline fallback. The bespoke clients in [`backend/app/assessment/providers/`](backend/app/assessment/providers) are superseded on the agent path by LangChain models (so LangSmith traces them); structured output via `.with_structured_output`.
- **Knowledge graph:** built in-process (networkx) from existing Postgres relational data + the 2D coordinates already in [`frontend/lib/floor_plan_map.json`](frontend/lib/floor_plan_map.json) (reuse for spatial radius — no new geodata needed). Neo4j is an explicit non-goal.
- **New dependencies:** `langgraph`, `langchain`, `langchain-openai`, `langchain-ollama`, `langsmith`, `networkx`.
- **Kept as-is:** review state machine, decisions/evidence, reports, notifications, twin shell, pgvector RAG retrieval + deterministic fallback.

## Protect-under-pressure order (4 days)

1. Multi-agent compound-risk engine + live reasoning stream (the hero).
2. Knowledge graph + Spatial Agent radius correlation.
3. Simulator split into source sims + orchestrator sim.
4. Incident Pattern Agent (RAG echo) surfaced in the trace.
5. Generative shift-handover brief.
6. Polish: KG visualization, provider/latency tuning, demo choreography.

Cut from the bottom up. Items 1-3 are the winning core.