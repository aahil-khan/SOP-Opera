# Brief Coverage Table

Coverage assessment against the competition brief's six required capabilities.
Format: brief bullet | coverage | one honest sentence.

Coverage values: fully covered / partially covered / not covered.

| brief bullet | coverage | one honest sentence |
|---|---|---|
| Compound Risk Detection Engine | fully covered | The rule engine evaluates 16 deterministic derived-fact rules and classifies risk using a seven-clause hazard-pathway policy that covers single-sensor incident lines, supervisor safety hazards, and compound pathways across atmosphere, ignition, exposure, and control dimensions. |
| Geospatial Safety Heatmap | partially covered | The Digital Twin renders a three-floor SVG floor plan with per-asset risk colouring and a spatial knowledge graph (NEAR/ABOVE relations between assets), but does not produce a continuous spatial gradient or geospatial heatmap. |
| Incident Pattern Intelligence | partially covered | Historical incidents and near-misses are retrieved as evidence during assessments by genuine vector search (`EMBEDDING_PROVIDER=openai_compatible`, gate 0.52 measured by `app.eval.rag_calibration`), and `/history` reads the corpus as a year — verdicts per month, which derived facts fire most, and the most-cited OISD/Factories Act clauses, which is where prevention priorities come from. What is still absent is automated *discovery*: the page surfaces the patterns a careful manual tabulation would find, not ones it would miss. Ranked candidate-rule mining (W13) is deliberately not built. |
| Digital Permit Intelligence Agent | partially covered | Permit-related derived facts (permit conflict, incomplete isolation, simultaneous ops) are detected by the rule engine with PTW SOP citation, but permit intelligence is embedded in the general derived-fact system rather than implemented as a dedicated agent. |
| Emergency Response Orchestrator | fully covered | A four-tier response orchestrator is implemented — Tier 0 preserves evidence, Tier 1 warns (PA, exclusion signage, response team page), Tier 2 protects (ventilation, tool gate, permit freeze, muster alarm), and Tier 3 actions are evaluated and persisted as visible refusals — gated by a reversibility envelope that enforces four autonomous-action clauses. |
| Quality & Compliance Audit Agent | not covered | The platform records assessment decisions in a SHA-256 chained audit trail with frozen evidence snapshots downloadable as PDF and Excel, but a proactive compliance audit agent that evaluates decisions against named SOP clauses is not implemented. |

---

## Notes

Coverage is assessed against the submitted `main` branch only. Functionality present on feature branches is not counted as implemented in the product.

The distinction between fully covered, partially covered, and not covered reflects whether the brief's stated capability exists as an end-to-end working feature, exists in part, or is absent. The presence of supporting infrastructure (audit trail, incident corpus, permit rules) does not by itself constitute coverage of the named capability.

*Feeds W8 (README coverage table and claim audit). See also `docs/finals/sop-clause-map.md` for the derived-fact to SOP mapping.*
