# Operational Review Platform
### Product Requirements Document — Version 1.0 (Frozen for Build)
**Status:** Frozen | **Owner:** Product Management | **Classification:** Internal

*Revision note: this draft adds formal definitions for the Operational Review, Operational Assessment, and Decision objects; a Review state machine; explicit context source and module boundaries; and Engineering Assumptions / MVP Invariants sections. The bar for this revision: four people should be able to read this document independently and build the same product.*

---

## 1. Executive Summary

The Operational Review Platform is a decision-support system that sits above existing industrial software — SCADA, DCS, SAP PM/WCM, Maximo, PTW systems, CCTV, and incident databases — and gives supervisors a single, explainable point of judgment before high-risk work begins.

The product is built around three distinct objects, deliberately kept separate: the **Operational Review**, which the platform owns and tracks from creation to closure; the **Operational Assessment**, which the AI produces as a structured, explainable analysis; and the **Decision**, which belongs to a named, accountable supervisor. This separation is the design decision that makes the product trustworthy inside a real safety organization, and it is now defined precisely enough to build against — see Sections 11–14.

The platform does not replace any existing system and does not control any plant equipment. V1 is deliberately narrow: a closed set of six high-consequence activity types, native-mode operation with no mandatory integrations, and one hero workflow executed completely rather than many capabilities executed shallowly.

---

## 2. Vision

A future in which no industrial worker dies because information that already existed inside the plant's own systems failed to reach the person making the go/no-go call.

We do not believe this requires more sensors, more dashboards, or more software vendors. It requires one disciplined layer that performs, systematically and every time, the synthesis a supervisor is currently expected to perform from memory under time pressure — and that leaves behind a permanent, honest record of what was known and what was decided, so that record itself becomes the raw material for better decisions next time.

---

## 3. Product Philosophy

1. **Build a product, not an AI demo.** Every capability must be something a safety officer would want to use on a Tuesday, not something that impresses a judge on a Saturday.
2. **One hero workflow.** AI-Assisted Operational Review. Every module either directly serves this workflow or does not belong in the product.
3. **The platform owns the review. The AI owns the assessment. The human owns the decision.** These three things are never allowed to blur into one another. See Sections 11–14.
4. **Integrate, don't replace.** The platform has no ambition to become the plant's system of record for maintenance, permits, or assets.
5. **Native first, connected better.** The platform must produce genuine value in a plant with zero integrations. Integrations improve the *quality* of an assessment; they are never a prerequisite for the product to function. See Section 15.
6. **Context over data.** We do not ask plants to instrument anything new. We ask them to let us read what they already have, or to tell us directly.
7. **Explain everything.** An assessment with no visible reasoning is not a feature in this product — it is a liability.
8. **Enterprise realism.** If a feature could not be deployed inside a real, unionized, regulator-scrutinized Indian industrial plant within a 90-day pilot, it does not belong in V1.

---

## 4. Problem Statement

India's heavy industry recorded over 6,500 fatal workplace accidents in FY2023 by DGFASLI's own count — a figure that excludes most mining and construction fatalities. The Visakhapatnam Steel Plant coke oven explosion in January 2025, which killed eight workers, is instructive precisely because it happened at a facility with functioning gas detectors, permit-to-work controls, and SCADA. The Wire's investigation found the warning signals existed. They simply never reached the operational decision in time.

This is not an isolated failure. A 2024 FICCI survey found that over 60% of large industrial facilities coordinate between their own digital safety tools through manual handoffs. The pattern is structural: data is present, distributed across systems that don't talk to each other, and reassembled — if at all — inside the head of a supervisor who is also managing a live operation.

The problem is not sensing. It is synthesis under time pressure, performed manually, at the exact moment when errors are least recoverable.

---

## 5. Research Insights

Industrial plants are not under-instrumented. A typical large facility already runs SCADA, DCS, SAP PM, SAP WCM, IBM Maximo or equivalent, CCTV, IoT sensor networks, PTW software, and incident/near-miss databases.

Each system is authoritative within its own domain and blind outside it. SCADA knows gas pressure. The PTW system knows a hot work permit was issued. Maximo knows a valve is under maintenance. None of them know that all three are true at the same location, at the same time — the exact combination that preceded the VSP incident.

This produces cognitive overload, not information scarcity, for the person who must decide whether to authorize work.

**Core insight:** the opportunity is not to collect more data. It is to sit across the systems that already exist and perform, systematically, the synthesis a supervisor currently performs by memory — and to leave behind a record that makes the next synthesis better than the last.

---

## 6. Product Positioning

**For** shift supervisors and safety officers at large industrial facilities **who** must authorize high-risk operational activities under time pressure, **the Operational Review Platform** is an AI-assisted review layer **that** produces an explainable Operational Assessment by fusing context from the plant's existing systems before work is authorized — **unlike** standalone PTW software, SCADA alarms, or manual cross-checks, which each see only one slice of the operational picture.

The platform is explicitly **not** a SCADA replacement, not an ERP, not a predictive maintenance tool, not a chatbot, and not an autonomous control system. It produces assessments; it never makes decisions and never executes actions.

---

## 7. Users

| Tier | Role | Relationship to Product |
|---|---|---|
| Primary | Shift Supervisor / Area In-Charge | Creates Reviews, receives Assessments, owns the Decision |
| Primary | HSE / Safety Officer | Configures assessment logic, reviews flagged high-severity cases, owns compliance posture |
| Secondary | Plant Operations Head | Consumes closed-Review trend reporting, sets policy on which activities require review |
| Secondary | Contractor Foreman / Work Executor | Supplies context during Context Collection; consumes the final decision |
| Tertiary | Corporate EHS / Compliance | Uses the audit trail and closed-Review reports for regulatory and board reporting |
| Tertiary | Regulatory Auditor (OISD/DGMS/Factory Inspectorate) | Indirect consumer via generated compliance documentation |

---

## 8. User Personas

**Rajesh — Shift Supervisor, Steel Plant**
16 years on the floor, accountable for every authorization signed on his shift. Wants a fast, honest assessment — not another form, not a system that decides for him without showing its work.

**Priya — HSE Manager**
Owns the safety KPI board and dreads audit season. Wants systemic visibility into recurring risk patterns without needing to be in the control room to catch them.

**Anand — Plant Operations Head**
Accountable to the board for both output and safety record. Doesn't want a new dashboard to check; wants confidence that supervisors are making decisions with the same context, consistently, across every shift.

**Deepak — Contractor Foreman**
Executes hot work and confined-space jobs on a fixed schedule. Wants clarity, not friction — a system that tells him what's blocking a decision and why.

---

## 9. Existing Workflow

1. A crew requests a permit for high-risk work through the PTW system or on paper.
2. The requesting party manually checks — from memory, radio calls, or a walk to the control room — whether the area has active maintenance, unusual gas readings, or overlapping permits.
3. The supervisor reviews the request, drawing on personal knowledge, informal handovers, and whatever alarms happen to be visible on the SCADA screen at that moment.
4. If nothing looks obviously wrong, the permit is approved. Compound conditions across systems the supervisor didn't personally check are invisible by construction.
5. If an incident occurs, reconstructing "what did we actually know at approval time" happens after the fact, by an investigator manually pulling logs from four or five separate systems.

---

## 10. Proposed Workflow

1. A high-risk activity is raised as an **Operational Review**.
2. **Context Collection** assembles available information from Native Mode input and, where present, Connected Mode integrations.
3. The **Operational Assessment Engine** and **Recommendation Engine** together produce an **Operational Assessment**: a structured analysis with full supporting evidence, never a bare score.
4. The supervisor reviews the Assessment and records a **Decision** — Approved, Rejected, or Deferred — which is theirs alone to make, with any divergence from the recommendation logged and reasoned.
5. **Execution** proceeds under the supervisor's authorization, exactly as today, if Approved.
6. **Completion** records the actual outcome of the work.
7. The Review is **Closed**, and its full history becomes part of the evidence base the next Operational Assessment, anywhere in the plant, reasons over.

---

## 11. Operational Review

> An Operational Review is the central business object of the platform. It represents a high-risk operational activity that must be reviewed before execution.

Each Operational Review owns:

- **Metadata** — activity type, creation time, current state.
- **Involved assets** — equipment, units, zones relevant to the activity.
- **Involved workers** — crew, contractor, and supervisor of record.
- **Work location** — the specific plant area the activity concerns.
- **Review timeline** — the full timestamped history of state transitions (Section 14).
- **Collected evidence** — the output of Context Collection (Section 15).
- **Its Operational Assessment** — exactly one active AI-generated analysis (Section 12).
- **Supervisor decisions** — the Decision record (Section 13).
- **Notifications** — communications sent in relation to it.
- **Generated reports** — the audit-ready output produced on closure.
- **Audit history** — the permanent, tamper-evident record.

Every feature in the platform exists to enrich or act upon an Operational Review. If a proposed capability cannot be described as "does something to an Operational Review," it does not belong in this product. This object is the entire data model: nothing in the platform exists independently of it.

---

## 12. Operational Assessment

> An Operational Assessment is the AI-generated analysis attached to an Operational Review.

It is produced once Context Collection completes. It is **not editable by users** — a supervisor does not edit an Assessment, they respond to it with a Decision. If the underlying context changes materially before Execution, a new Assessment is produced; the prior one is preserved as part of the Review's history, never overwritten.

An Operational Assessment contains:

- **Detected compound risks** — the specific combinations identified by Compound Risk Reasoning.
- **Supporting evidence** — the source data points that produced each detected risk.
- **Reasoning** — the explanation chain connecting evidence to conclusion.
- **Confidence** — how certain the Assessment is in its own output.
- **Regulatory references** — applicable OISD/DGMS/Factory Act guidance and internal SOPs, from Compliance Validation.
- **Recommendations** — the suggested course of action, produced by the Recommendation Engine from the above.

The Assessment never executes actions. It only assists the supervisor. Exactly one Assessment is active on a Review at a time.

---

## 13. Decision

The Decision is the record of the supervisor's response to an Operational Assessment. It is owned by the Review, not by the Assessment — a Decision belongs to the human who made it and is the authoritative next step for the Review regardless of what the Assessment recommended.

A Decision records:

- **Outcome** — Approved, Rejected, or Deferred.
- **Deciding supervisor** — the named, accountable individual.
- **Timestamp**.
- **Reason** — required whenever the Decision diverges from the Assessment's recommendation; optional otherwise.

Sections 11–13 together express the platform's organizing principle: the platform owns the Review, the AI owns the Assessment, the human owns the Decision. None of the three can substitute for another, and no feature may be designed in a way that blurs this boundary.

---

## 14. Review States

The Operational Review moves through a single, linear state machine:

```
Created
   ↓
Context Collection
   ↓
Assessment Running
   ↓
Assessment Ready
   ↓
Supervisor Reviewing
   ↓
   ├── Approved  → Execution → Completed → Closed
   ├── Rejected  → Closed
   └── Deferred  → Closed (or reopened to Context Collection if the blocking condition resolves)
```

- **Assessment Running** and **Assessment Ready** are distinct states because Assessment generation is not instantaneous, and the platform must represent "in progress" honestly rather than leaving a Review in an ambiguous state.
- **Rejected** and **Deferred** Reviews close without proceeding to Execution. A Deferred Review may be reopened into Context Collection if the blocking condition is resolved; a Rejected Review may not.
- Every state transition is timestamped and forms part of the Review's audit history.
- A **Closed** Review is not inert: it becomes part of the plant's permanent record and an input to Historical Incident Analysis for every future Assessment. This is how the platform compounds in value — every closed Review makes the next one slightly better informed.

This section is the authoritative definition of the Review lifecycle referenced narratively elsewhere in this document.

---

## 15. Native Mode, Connected Mode & Context Sources

**Native Mode** is the platform's default operating condition and must be fully functional with zero enterprise integrations. A user creates an Operational Review by supplying structured input directly: Review Type, Work Description, Equipment, Location, Workers, Department, Planned Time, Attachments, and a Manual Checklist.

On this input alone, the Assessment Engine can still produce a genuine Operational Assessment, because several of its reasoning capabilities require no live integration: the manually entered context, the plant's historical incident record, applicable regulations and SOPs, static plant topology, and previously closed Reviews.

**Connected Mode** layers live data on top of Native Mode to progressively enrich the Assessment. It never gates the product's core function; it only improves the confidence and specificity of what Native Mode already produces.

**Context Sources**, precisely:

| Native | Connected |
|---|---|
| Review Form | Sensors |
| Manual Inputs (checklist, free-text notes) | SCADA |
| Attachments | SAP |
| | Maximo |
| | CCTV Metadata |
| | Shift Logs |
| | Incident Database |
| | Weather |
| | Regulations |

The Context Engine (Section 16) standardizes all of these inputs into a unified representation before an Assessment is produced. How that standardization works is a Technical Design Spec question (Section 30), not a product question — this section defines what counts as context, not how it is processed.

---

## 16. Module Responsibilities

Each module below has exactly one owner and one responsibility. Where a proposed capability doesn't fit cleanly into one of these seven, that is a signal to say no to the capability, or to explicitly define an eighth module — not to let an existing module absorb a second responsibility.

- **Operational Review Module** — Owns the Review lifecycle: creation, state transitions, closure.
- **Context Engine** — Owns information gathering: capturing Native Mode input and ingesting Connected Mode data, standardizing both.
- **Operational Assessment Engine** — Owns AI reasoning: Context Fusion, Compound Risk Reasoning, Historical Incident Analysis, and Compliance Validation. Produces detected risks, evidence, reasoning, confidence, and regulatory references.
- **Recommendation Engine** — Owns action suggestions: translates the Assessment Engine's output into the Assessment's recommendation. Kept distinct from the Assessment Engine because "what is risky" and "what should be done about it" are different judgments, easier to reason about, audit, and improve separately.
- **Digital Twin** — Owns visual explanation: a static, Review-scoped view answering "why did the AI reach this recommendation." Not a monitoring dashboard, not a live plant view.
- **Report Engine** — Owns documentation: generates the audit-ready record of a closed Review.
- **Notification Engine** — Owns communication: routes status changes to the right people at the right time.

**Explainability is not a separate module.** It is a required property of the Assessment Engine's and Recommendation Engine's output — the "reasoning" and "evidence" fields defined in Section 12 — surfaced to the supervisor directly and visualized where useful by the Digital Twin.

---

## 17. Hero Workflow

A contractor foreman raises an Operational Review for a hot work job on a pipeline section. Context Collection pulls in the active permit and checks it against maintenance and gas-sensor data for that zone. The Assessment Engine's Compound Risk Reasoning finds that a valve isolation in the adjacent unit is still recorded as incomplete, and that a gas sensor in the same zone logged an elevated reading six hours earlier — a combination that Historical Incident Analysis matches to two prior near-misses in the plant's own closed-Review history.

The Recommendation Engine translates this into a recommendation to hold the work pending isolation confirmation, attached to the Assessment along with the specific evidence — which permit, which sensor reading, which maintenance record, which two prior incidents.

The supervisor reviews the Assessment and records a Decision: **Deferred**, pending isolation confirmation. Once confirmed, the Review is reopened, reassessed, and the supervisor records **Approved**. Execution proceeds, Completion is recorded, the Review is Closed, and it becomes part of the evidence Historical Incident Analysis draws on for the next Assessment, anywhere in the plant.

---

## 18. Hero Capability

**AI-Assisted Operational Review** is the single capability the entire product exists to deliver: before irreversible, high-consequence work begins, assemble the context that already exists across the plant's own systems, produce an Operational Assessment that reasons over it explainably, and hand the accountable human a clear, evidence-backed Decision point.

This is the one moment in the operational lifecycle where intervention is cheap and consequence is not yet locked in. Every other capability in this product supports making that single moment better, and making the next one better still.

---

## 19. Product Principles

1. **The platform owns the review. The AI owns the assessment. The human owns the decision.** The organizing principle of the entire product, never violated for convenience.
2. **Assessment before action, never instead of action.** The AI's output is always attached to a pending Decision, never an autonomous act.
3. **No black-box scores.** An Assessment is always accompanied by the specific evidence that produced it.
4. **The false-positive / false-negative tradeoff is acknowledged, not solved.** The platform exposes confidence, severity, contributing evidence, and explanation. It does not attempt to algorithmically resolve how cautious an Assessment should be — that judgment belongs to the supervisor.
5. **Plant-native language.** Output is written for a supervisor on a shift floor, not a data scientist.
6. **Override is a first-class action.** Not an edge case, not a friction point to be minimized away.
7. **One accountable human per Review.** Ambiguity about who decided is treated as a product defect.
8. **Native Mode is a real mode, not a degraded one.** A plant with no integrations must still get a genuinely useful Assessment.

---

## 20. Constraints

- **OT/IT separation.** Many plant systems sit on isolated operational networks; the product must assume read-only, latency-tolerant, and sometimes entirely absent Connected Mode data.
- **Regulatory non-mandate.** No Indian regulation currently mandates a platform like this; adoption must be earned on operational value.
- **Human-in-the-loop is a hard constraint,** not a configurable setting.
- **Data quality varies widely** across plants and systems.
- **Union and workforce sensitivities** require the platform to be positioned as support for supervisors, not surveillance of them.
- **Low-connectivity environments** require graceful degradation to Native Mode without loss of core function.

---

## 21. What We Deliberately Chose Not to Build

- **A single plant-wide risk score or traffic-light dashboard.** Recreates the exact failure mode the product exists to fix — a number glanced at and trusted rather than an Assessment read. Every Assessment stays scoped to one Review.
- **Auto-approval below a confidence threshold.** Would quietly convert decision support into decision replacement. There is no confidence level at which the Decision step is skipped.
- **A conversational chatbot for querying plant risk.** Produces answers not attached to a specific, accountable Review, and therefore unauditable the way an Assessment is. Every AI output belongs to a Review or it doesn't exist.
- **Continuous, plant-wide CCTV-based worker monitoring.** Reads as surveillance to the workforce whose trust the product depends on, and doesn't serve the pre-authorization Decision.
- **A gamified safety scoreboard across supervisors or departments.** Would incentivize minimizing flagged Reviews rather than surfacing risk honestly.
- **Continuous autonomous compliance auditing, independent of any Review.** A genuinely different workflow — inspection, not pre-work decision support.
- **Cross-plant or portfolio benchmarking in V1.** Requires a data-sharing and governance model not yet earned with a single-plant pilot.
- **A live, continuously updating plant-wide geospatial heatmap.** The Digital Twin stays scoped to explaining one Assessment; a live plant-wide layer is a different, larger product.

---

## 22. Non-Goals

- **SCADA/DCS replacement** — the platform reads signals; it never controls equipment.
- **ERP replacement** — SAP PM/WCM remains the system of record for maintenance and work orders.
- **Asset management** — ownership of asset lifecycle data stays with Maximo or equivalent.
- **Predictive maintenance platform** — equipment failure forecasting is a distinct product category.
- **Inventory system** — not addressed by this product.
- **Autonomous plant control** — the platform never issues control commands.
- **General-purpose AI chatbot** — see Section 21.
- **Full digital twin / live plant management system** — see Sections 16 and 21.
- **Autonomous emergency response orchestration** — fundamentally different from decision support before execution; out of scope for this product's philosophy, not just its V1 timeline.
- **General work management** — the Operational Review taxonomy is a closed set of high-risk activity types (Section 23), not an extensible ticketing system for routine work.

---

## 23. MVP Scope

**Operational Review taxonomy (closed set for V1):** Hot Work, Confined Space Entry, Equipment Restart, Isolation Removal, Critical Maintenance, Shutdown Activities. This list is deliberately closed, not extensible by configuration.

**Recommended pilot sequencing:** launching all six simultaneously spreads early validation effort thin. We recommend a first pilot deployment on three — **Hot Work, Confined Space Entry, Isolation Removal** — with the remaining three following within the same V1 release cycle once the Assessment logic and Explainability are validated against real supervisor feedback. This is a sequencing decision, not a scope cut; all six remain V1.

**In scope for V1:**
- Full lifecycle per Section 14.
- Native Mode, fully functional with zero external integrations.
- Optional read-only Connected Mode integration with one PTW system and one sensor/SCADA feed.
- All Assessment Engine and Recommendation Engine outputs, each explainable.
- Digital Twin, scoped to a single Review.
- Audit-ready report generation per closed Review.

**Explicitly deferred (Future Scope, not V1):**
- Any activity type outside the closed taxonomy above.
- Live plant-wide geospatial heatmap.
- CCTV/computer vision analytics.
- Multi-plant/portfolio rollup reporting.
- Continuous, Review-independent compliance monitoring.

See Sections 24–25 for the engineering-level guardrails governing this scope.

---

## 24. Engineering Assumptions

These are stated once here so they do not need to be re-litigated during implementation. They apply to the MVP build, not to the product's long-term design.

- Enterprise integrations will be simulated where necessary.
- Plant telemetry will be generated through a deterministic simulator.
- Sensor values are assumed to be trustworthy.
- AI recommendations are advisory only.
- The platform evaluates one Operational Review at a time.
- Plant topology is predefined.
- Multi-plant deployments are out of scope.
- Authentication and enterprise administration are simplified for the prototype.

---

## 25. MVP Invariants

These rules cannot be violated during implementation. They are architectural guardrails, not product features, and exist so that implementation decisions can be made quickly without constantly revisiting the rest of this document.

- Every feature must belong to an Operational Review.
- Every AI recommendation must include evidence and an explanation.
- The AI cannot execute operational actions.
- Every recommendation must be reviewable by a human.
- The platform must remain usable without enterprise integrations.
- The Digital Twin is an explanation view, not a monitoring dashboard.

---

## 26. Success Metrics

**Leading indicators**
- % of in-scope Operational Reviews that receive an Operational Assessment before work execution begins.
- Median time from Review creation to Supervisor Decision.
- Context completeness at time of Assessment.

**Quality indicators**
- Precision and false-negative rate of Compound Risk Reasoning flags, validated against safety officer review.
- % of Assessments the supervisor agrees with unmodified vs. overrides (tracked, not judged — overrides are expected and healthy).
- Supervisor-reported clarity/trust score for Assessment explanations.

**Business impact indicators**
- Reduction in high-risk near-misses for in-scope activity types, measured against pre-adoption baseline.
- Reduction in audit preparation time for in-scope activity types.
- Growth in Historical Incident Analysis corpus size and its measurable effect on Assessment specificity over time.

**Adoption indicators**
- % of eligible high-risk activities routed through an Operational Review vs. bypassed via legacy process.

---

## 27. Future Scope

- Expansion of the Operational Review taxonomy beyond the closed six, on evidence from V1 usage.
- Live, plant-wide geospatial risk heatmap, as an evolution of the per-Review Digital Twin.
- CCTV/computer vision integration for automated context capture, with a workforce-trust framework in place first.
- Multi-plant and portfolio-level trend intelligence for corporate EHS.
- Contractor-facing self-service portal.
- Continuous, Review-independent compliance monitoring agent, as a separate module.
- A separate, explicitly distinct Emergency Response product, if pursued at all.

---

## 28. Risks and Assumptions (Product-Level)

**Assumptions**
- Supervisors will adopt and trust Operational Assessments if the reasoning is visible and their authority to override is real and respected.
- Plants can supply sufficient Native Mode context to make assessments genuinely useful, even without integrations.
- Early customers will accept a closed, six-activity-type V1 in exchange for depth and reliability over breadth.

**Risks**
- **The false-positive / false-negative tradeoff is real and unresolved by design** (Principle 4). Usefulness depends on supervisors engaging with nuance rather than wanting a single verdict.
- **Liability ambiguity:** unclear accountability when a supervisor follows, modifies, or overrides an Assessment and an incident subsequently occurs.
- **Integration fragility:** legacy OT systems and air-gapped networks may slow even read-only Connected Mode integration.
- **Adoption resistance:** the platform can be perceived as extra process or covert monitoring, particularly by unionized workforces.
- **Automation complacency:** consistently accurate Assessments could cause supervisors to defer judgment rather than genuinely evaluate evidence — directly undermining Principle 1.

---

## 29. Open Questions

1. Should routing high-risk activities through an Operational Review be **mandatory by plant policy**, or remain voluntary?
2. What is the **minimum viable context** below which the Assessment Engine should decline to produce a recommendation rather than a low-confidence one?
3. How should the product handle a plant that is **entirely paper-based** — is Native Mode still viable, or is there a data floor below which the product cannot function?
4. Should closed Operational Reviews be positioned for eventual **formal recognition in regulatory audits**?
5. What is the right **language and localization** strategy for plant-floor use?
6. Should the six-activity-type taxonomy be **fixed per customer at contract time**, or eligible for narrow, governed expansion during a pilot?

---

## 30. Appendix: Explicitly Deferred to the Technical Design Spec

The following are intentionally absent from this document. Their absence is a scope decision, not an oversight, and they belong in a separate Technical Design Spec once this PRD is frozen:

Architecture, AI pipeline design, prompting strategy, LLM selection, database schema, event engine, Digital Twin implementation, frontend structure, backend APIs, technology stack, MQTT/WebSockets, deployment.

---

*End of document.*
