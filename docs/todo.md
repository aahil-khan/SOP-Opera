show live readings - done

evidence menu needs separation


reasoning failed route


cctv feeds?

- - AUDIO CHIME ON NEW REVIEW

- closed menu should show what happende

- ai ops is resetting

- what should clicking on closed stuff do
- update make a decision
- filter specific types of errors

- Emergency Response Orchestrator — Autonomous agent that, on confirmed trigger,
immediately initiates evacuation protocols, alerts response teams across channels,
preserves sensor evidence, and generates a preliminary regulatory-compliant 

- add option to configure thresholds and rules etc -- done

---
test this

 eval harness — is ready to test.

Graph — Sources are context/fact-gated via Send; spatial runs only after elevated signals; incident + handover only on elevated/blocking verdicts. Nominal path is orchestrator-only.

RAG — Skipped with no facts; vector search is incidents-only; deterministic regs/SOPs still load for evidence. Plant neighborhood load is skipped when spatial cannot fire.

UI — Brain empty state: “Waiting for domain signals…”

Tests — 26 related unit tests passing, including new routing coverage.
---

All three gaps are wired and covered by tests (7 new + existing graph/incident suites green).

Source narration — Selected domains with active facts call the LLM (1–2 sentences); mock/failure use templates; clearance stays template-only (no LLM).

Orch citations — Prompt fuses domain narratives without restating them, and cites up to 2 retrieved refs (incident + reg/SOP). Mock summary can append an incident title.

Incident titles — _serialize_ref keeps title / code / triggered_by_fact; stubs only when the corpus is empty; titled real refs win the observation headline.
---