# Canonical Domain Model
### Operational Review Platform — v1.0

Companion to: PRD v3 (frozen)
Precedes: Technical Design Specification
Status: Draft for engineering review

---

## 1. Domain Philosophy

A Technical Design Specification answers "how do we build it." A PRD answers "what should it do for users." Neither answers the question that actually determines whether a team of engineers builds one coherent system or five incompatible ones: **what are the things, and who is allowed to change them.**

That is the only job of this document. It is deliberately silent on storage, transport, and framework, because those choices should never be allowed to bend the shape of the domain. If a database migration or a library swap would force a rewrite of this document, this document was wrong.

Two working rules govern everything below:

- **The refinery test.** Every object in this model is asked: *would this concept still exist if we replaced the demo plant with a real refinery, run by a customer we've never met?* If the honest answer is no — if the concept only exists because of how the demo happens to be wired — it does not belong here. It belongs in a Context Provider adapter, described in the Technical Design Specification, not in the domain.
- **Fewer, stronger concepts.** Where two candidate objects differ only in where their data comes from, they are the same object. Where an object has no independent lifecycle and no invariant of its own, it is not an object — it is an attribute of something else.

Domain objects are not data structures. They are commitments about ownership and responsibility that the rest of the platform is built to respect.

---

## 2. Core Domain Objects

### Merge / rename decisions made against the seed list

Before enumerating the final objects, four departures from the suggested list, with reasoning:

- **Sensor Reading — removed.** A sensor reading is one shape that a **Context** can take. It fails the refinery test as a standalone concept: a real refinery has thousands of context sources, of which sensors are only one, and the platform is explicitly required to treat all of them identically. Promoting "Sensor Reading" to a first-class object would quietly re-introduce a SCADA-shaped bias into a document that is supposed to be provider-agnostic.
- **Review Timeline — removed.** A timeline is a read of **Audit Entries** filtered to one Review. It has no lifecycle of its own, no owner distinct from the Review, and no invariant that isn't already an Audit Entry invariant. Keeping it as a separate object would create two sources of truth for the same history.
- **Review State — demoted from object to value.** State has no identity, no independent lifecycle, and cannot exist detached from a Review. It is a property of the Review, governed by the state machine in Section 7.
- **Review Owner — removed as a standalone object, absorbed into Review Participant.** "Owner" is a role, not a kind of thing. Making it an object separate from other roles (Contributor, Decision Maker, Observer) would force the platform to model the same underlying relationship — a person assigned to a Review — twice.

### The objects

---

#### Operational Review — *Aggregate Root*
**Purpose:** The unit of work. Everything the platform does happens in service of opening, progressing, or closing a Review.
**Owner:** The Platform.
**Responsibilities:** Holds its own state and enforces legal transitions between states (Section 7); is the boundary that all Assessments, Decisions, Evidence, and Participant assignments live inside.
**Lifecycle:** See Section 7 in full.
**Relationships:** Contains Operational Assessments, Decisions, Evidence, and Review Participant assignments. References — but does not contain — an Asset, optionally a triggering Incident, and any number of Permits or Compliance Rules relevant to the review.
**Invariants:** Exactly one active Owner at all times; cannot be closed while an Assessment is in progress; cannot skip directly from Opened to Closed without at least one Decision, except where explicitly voided (Section 7).
**Does NOT own:** The Asset it concerns, the Worker(s) it concerns, or any Compliance Rule it cites. It references master data; it does not become the source of truth for it.

---

#### Operational Assessment
**Purpose:** The AI's structured judgment of risk for a Review, at a point in time, given the Context available.
**Owner:** The AI.
**Responsibilities:** Synthesizes Context and Evidence into a risk position; produces zero or more Recommendations; is superseded, never edited, when new Context materially changes the picture.
**Lifecycle:** Requested → Generating → Complete → *(optionally)* Superseded by a later Assessment on the same Review.
**Relationships:** Belongs to exactly one Operational Review. Produces Recommendations. Draws on Evidence.
**Invariants:** Immutable once Complete — a changed judgment produces a new Assessment, not a mutation of the old one; every Assessment belongs to exactly one Review; a superseded Assessment is retained, never deleted.
**Does NOT own:** The Decision made in response to it. The AI assesses; it does not decide. This is the load-bearing boundary of the entire product.

---

#### Recommendation
**Purpose:** A specific, actionable suggestion produced as part of an Assessment.
**Owner:** The AI, until a human disposes of it.
**Responsibilities:** Represents one candidate action; carries its own accept/reject status independent of the rest of the Assessment.
**Lifecycle:** Proposed → Accepted / Rejected / Expired (superseded by a newer Assessment before being acted on).
**Relationships:** Produced by exactly one Operational Assessment. Referenced by a Decision when accepted or rejected.
**Invariants:** Cannot exist without a parent Assessment; once Accepted or Rejected, that disposition is permanent and belongs to the Decision that made it, not to the Recommendation itself.
**Does NOT own:** Its own disposition history — that is recorded as part of the Decision and the Audit Entry, so that "why was this accepted" is answerable from the human side of the boundary, not the AI side.

---

#### Decision
**Purpose:** The human's binding call on a Review — the only object in this model that carries authority to change what happens in the physical world.
**Owner:** The Human — specifically, the Review Participant holding the Decision Maker role at the time.
**Responsibilities:** Records what was decided, which Recommendations were accepted or rejected, and closes off (or escalates) the question the Review was opened to answer.
**Lifecycle:** Submitted → immutable. There is no draft state visible to the domain; a Decision that has not been submitted is not yet a Decision.
**Relationships:** Belongs to exactly one Operational Review. May reference one or more Recommendations it accepted or rejected. May reference the Evidence it was based on.
**Invariants:** Immutable once submitted; a Review cannot have two open (non-superseded) Decisions simultaneously; a Decision cannot exist without a submitting Review Participant who held Decision authority at submission time.
**Does NOT own:** The Assessment it responds to, and does not own execution of whatever it decided — the platform records the decision, it does not carry out physical-world actions.

---

#### Context
**Purpose:** The canonical, provider-agnostic unit of information the platform reasons over. This is the translation layer that makes the platform indifferent to where information came from.
**Owner:** The Platform (via Context Ingestion — see Section 8).
**Responsibilities:** Represents one normalized fact about the world at a point in time, regardless of whether it originated from a person typing, an enterprise system, a live feed, or a simulation.
**Lifecycle:** Ingested → Valid → Stale (once its validity window lapses). Stale Context is not deleted; it simply stops being eligible to justify a new Assessment.
**Relationships:** Consumed by Operational Assessments. Selectively frozen into Evidence. Associated with the Asset, Worker, or Incident it pertains to.
**Invariants:** Every unit of Context has exactly one originating provider and a validity window; the platform must never expose which specific provider a Context came from as a reasoning input — Context is the only shape an Assessment is allowed to consume.
**Does NOT own:** Truth. Context is a claim ingested from somewhere else; the platform is not the authority on whether it's correct, only on whether it's current and admissible.

---

#### Evidence
**Purpose:** The specific, frozen subset of Context (and other domain facts) that was actually relied on to produce a given Assessment or Decision. This is what makes a Decision defensible after the fact, even after the underlying Context has moved on.
**Owner:** The Operational Review that assembled it.
**Responsibilities:** Preserves exactly what was known, and when, at the moment a judgment was made.
**Lifecycle:** Captured → permanently immutable. There is no further lifecycle.
**Relationships:** Assembled by a Review; cited by an Assessment and/or a Decision.
**Invariants:** Evidence is immutable — this is non-negotiable and cannot be revised even to correct an error; evidence never exists without a citing Assessment or Decision.
**Does NOT own:** Currency. Evidence is deliberately allowed to go stale relative to live Context — that staleness is the point; it's a photograph, not a window.

---

#### Incident
**Purpose:** A real-world safety-relevant event — the thing the entire platform ultimately exists to help prevent, or to explain after the fact.
**Owner:** The Platform, though the underlying fact of the incident is external to it.
**Responsibilities:** Represents an occurrence, independent of whether any Review was ever opened about it.
**Lifecycle:** Reported → Under Investigation → *(optionally)* Linked to one or more Reviews → Closed.
**Relationships:** May trigger an Operational Review. May be cited as Context or Evidence in unrelated Reviews (historical pattern matching). Associated with one or more Assets and Workers.
**Invariants:** An Incident's existence is never contingent on a Review — Incidents can and do occur, and get investigated, without the platform ever opening a Review about them.
**Does NOT own:** Any Review it triggers. The relationship is a reference, not containment — closing a Review does not close the Incident, and vice versa.

---

#### Asset
**Purpose:** The physical or logical thing being operated on — a unit, a line, a vessel, a piece of equipment. General-purpose by design; nothing about this object is shaped by the demo plant.
**Owner:** Master data, held by the Platform's registry.
**Responsibilities:** Provides the anchor that Context, Incidents, Permits, and Reviews are all hung off of.
**Lifecycle:** Registered → Active → Decommissioned.
**Relationships:** Referenced by Reviews, Context, Incidents, and Permits. Owns none of them.
**Invariants:** An Asset's identity is stable across its entire lifecycle, including decommissioning — history must remain attributable.
**Does NOT own:** Any Review, Incident, or Permit that references it. Assets are passive with respect to the domain; they are pointed at, not actors.

---

#### Worker
**Purpose:** A person whose safety, actions, or authorization are relevant to the operational picture — distinct from a Review Participant, which is a role someone plays *with respect to a specific Review*. The same person can be both, but the concepts are not the same thing.
**Owner:** Master data, held by the Platform's registry (or the enterprise system of record, referenced through Context).
**Responsibilities:** Anchors Permits, appears in Incidents, and can be the subject of Context (e.g., certification status, location, exposure).
**Lifecycle:** Registered → Active → Inactive.
**Relationships:** Referenced by Permits, Incidents, and Context. May separately hold a Review Participant role on one or more Reviews.
**Invariants:** A Worker's identity is independent of any role they hold on any given Review.
**Does NOT own:** Any Review they participate in — see Review Participant below.

---

#### Permit
**Purpose:** Authorization for specific work to occur on a specific Asset, typically time-bound and compliance-relevant (e.g., a permit-to-work). This concept survives the refinery test unchanged — every real industrial site runs on permits.
**Owner:** Master data / the compliance domain the enterprise already runs.
**Responsibilities:** Represents whether specific work was authorized, by whom, and under what constraints.
**Lifecycle:** Issued → Active → Expired / Revoked → Closed.
**Relationships:** References an Asset and one or more Workers. Referenced by Reviews and Context (permit status is a common input to an Assessment).
**Invariants:** A Permit's authorization window is immutable once issued; revocation is a new lifecycle event, not an edit to the original terms.
**Does NOT own:** Any Review that reads its status. The Review consumes Permit state as Context; it does not modify Permits.

---

#### Compliance Rule
**Purpose:** A standard, regulation, or internal policy that an Assessment or Decision may need to be checked against.
**Owner:** The regulatory/compliance domain — ingested and versioned by the Platform, not authored by it.
**Responsibilities:** Provides a stable, citable reference point for "this Assessment considered rule X, version Y."
**Lifecycle:** Drafted → Published/Active → Superseded/Retired. Rules are versioned, never overwritten.
**Relationships:** Referenced by Assessments and Decisions as part of Evidence.
**Invariants:** A Compliance Rule citation always resolves to a specific version, permanently — a later amendment must never silently change what an old Decision appears to have been checked against.
**Does NOT own:** Compliance itself. The rule is a reference; whether a given Asset or Review actually complies is a judgment the Assessment or Decision makes, not a property of the rule.

---

#### Review Participant
**Purpose:** The role a person plays with respect to one specific Review — Owner, Contributor, Decision Maker, or Observer. Replaces the seed list's standalone "Review Owner."
**Owner:** The Operational Review.
**Responsibilities:** Determines who may act on a Review, and with what authority, for as long as the assignment is active.
**Lifecycle:** Assigned → Active → Released (on reassignment or Review closure).
**Relationships:** Held by exactly one Worker (or platform user) per assignment; scoped to exactly one Review.
**Invariants:** Every Review has exactly one active Owner at any moment; Decision-submitting authority requires an active Decision Maker assignment at the moment of submission; a released assignment is retained for history, never deleted.
**Does NOT own:** The person's identity — that belongs to Worker. This object owns only the relationship between a person and a specific Review.

---

#### Notification
**Purpose:** An outbound signal to a stakeholder that something meaningful happened.
**Owner:** The Platform.
**Responsibilities:** Reacts to Domain Events (Section 6); carries no authority of its own.
**Lifecycle:** Triggered → Sent → *(optionally)* Acknowledged.
**Relationships:** Caused by exactly one Domain Event. Concerns exactly one Review (directly or via a Recommendation/Decision within it).
**Invariants:** A Notification never causes a state change — it is purely downstream; losing a Notification must never be able to corrupt Review state.
**Does NOT own:** Delivery guarantees, escalation logic, or anything about how or where it's shown. Those are Technical Design Specification concerns, not domain concerns.

---

#### Report
**Purpose:** A generated, human-readable artifact summarizing a Review (or set of Reviews) for an audience outside the platform's working session — typically produced at or after closure.
**Owner:** The Platform.
**Responsibilities:** Captures a point-in-time narrative of a Review: its Context, Assessments, Decision, and outcome.
**Lifecycle:** Generated → Published → immutable. A later change produces a new Report version, never an edit.
**Relationships:** Generated from exactly one Review at a point in time (or an explicit multi-Review summary, which is still a distinct generation event).
**Invariants:** A Report is immutable once published — if the underlying Review changes afterward (e.g., Reopened), that produces a new Report, not a revision of the old one.
**Does NOT own:** The Review it summarizes. It is a snapshot artifact, not a live view.

---

#### Audit Entry
**Purpose:** The permanent, append-only record of everything meaningful that happened, for compliance and reconstruction purposes.
**Owner:** The Platform.
**Responsibilities:** Records every Domain Event (Section 6) as it occurs, with enough context to reconstruct "what happened, when, and who or what caused it."
**Lifecycle:** Recorded → permanently immutable. There is no further lifecycle; this is the one object in the model with no state machine at all.
**Relationships:** References the Review, Assessment, Decision, or other object the event concerned. Not contained by any of them.
**Invariants:** Append-only, with no exceptions, including for correcting mistakes — a wrong Audit Entry is corrected by a new entry, never edited or deleted; ordering within a Review's history is never ambiguous.
**Does NOT own:** Interpretation. An Audit Entry records that something happened; it does not judge whether it was correct.

---

## 3. Object Relationships

```
                              ┌──────────────────────────┐
                              │   Operational Review      │   (Aggregate Root)
                              │   [ owns its own State ]  │
                              └─────────────┬──────────────┘
                                            │ contains
        ┌───────────────┬──────────────────┼───────────────────┬────────────────┐
        ▼                ▼                  ▼                   ▼                ▼
 Operational       Review              Decision            Evidence      (reacts, downstream)
 Assessment        Participant                                            Report
        │                                   ▲                             Notification
        ▼                                   │ cites                       Audit Entry
 Recommendation ───────────────────────────┘

 references only, never contains ─────────────────────────────────────────────►
 Asset  ·  Worker  ·  Incident  ·  Permit  ·  Compliance Rule  ·  Context
```

The left-hand cluster (Review, Assessment, Recommendation, Participant, Decision, Evidence) is written and read together, inside one transactional boundary. The right-hand cluster (Asset, Worker, Incident, Permit, Compliance Rule, Context) is master or reference data with its own lifecycle, pulled in by reference. The bottom cluster (Report, Notification, Audit Entry) never participates in the transaction that changes a Review — it only ever reacts to what already happened.

---

## 4. Aggregate Boundaries

**Aggregate Root: Operational Review.**

Objects that must never exist independently of it:
- **Operational Assessment** — cannot exist without a parent Review.
- **Recommendation** — cannot exist without a parent Assessment, and therefore without a Review.
- **Decision** — cannot exist without a parent Review.
- **Evidence** — cannot exist without the Review that assembled it.
- **Review Participant** (as an assignment) — cannot exist without a Review to be assigned to.

Objects with their own independent lifecycle and aggregate boundary, referenced by ID rather than contained:
- **Asset**, **Worker**, **Permit**, **Compliance Rule** — master/reference data. Each is created, changed, and retired on its own schedule, with or without any Review ever touching it.
- **Incident** — has its own lifecycle and can be reported and closed without a Review ever being opened about it.

Objects that are downstream artifacts, not part of any transactional boundary:
- **Report**, **Notification**, **Audit Entry** — each reacts to something that already happened inside the Review aggregate (or to master-data events). None of them can cause a change to a Review, and losing one must never corrupt Review state.

The practical rule this produces: anything inside the Review boundary is written together and must stay consistent together. Anything outside it is looked up, never edited through the Review.

---

## 5. Domain Invariants

1. Every Operational Review has exactly one active Owner at all times.
2. Every Operational Assessment belongs to exactly one Operational Review.
3. Every Recommendation belongs to exactly one Operational Assessment.
4. Every Decision belongs to exactly one Operational Review, and a Review never has two open Decisions simultaneously.
5. Evidence is immutable from the moment it is captured.
6. Audit Entries are append-only, with no exceptions.
7. A Decision, once submitted, is immutable.
8. An Operational Assessment, once Complete, is immutable — a revised judgment is a new Assessment, not an edit.
9. Context always carries a validity window and an originating provider; the platform never treats stale Context as eligible input to a new Assessment.
10. An Assessment may only be produced by the AI; a Decision may only be produced by a human holding an active Decision Maker assignment. These roles are never interchangeable, and the platform enforces this at every layer, not just at the point of entry.
11. A Compliance Rule citation always resolves to the exact version in force at citation time, permanently.
12. An Incident's existence and lifecycle are independent of whether any Review references it.
13. A Report, once published, is immutable; a later change to the underlying Review produces a new Report.
14. An Asset's identity remains stable and addressable across its entire lifecycle, including after decommissioning.

---

## 6. Domain Events

- Operational Review Opened
- Context Ingested
- Operational Assessment Requested
- Operational Assessment Completed
- Operational Assessment Superseded
- Recommendation Proposed
- Recommendation Accepted
- Recommendation Rejected
- Evidence Captured
- Decision Submitted
- Operational Review Escalated
- Operational Review Closed
- Operational Review Reopened
- Incident Reported
- Incident Linked to Review
- Permit Status Changed
- Notification Sent
- Report Generated

No payloads are defined here by design — that binds this document to a data shape, which is Technical Design Specification territory.

---

## 7. Review State Machine

| State | Meaning | Legal next states | Triggered by |
|---|---|---|---|
| **Opened** | Review created; context gathering underway | Assessing | Operational Review Opened |
| **Assessing** | An Assessment is being generated | Pending Decision, Assessing (re-entrant) | Assessment Requested / Completed |
| **Pending Decision** | Assessment complete; awaiting human judgment | Decided, Escalated, Assessing (if new Context invalidates the Assessment) | Assessment Completed, or new Context arriving |
| **Decided** | A Decision has been submitted | Closed, Escalated | Decision Submitted |
| **Escalated** | Requires authority beyond the current Decision Maker | Pending Decision, Decided, Closed | Explicit escalation trigger (human-initiated, or risk threshold breach surfaced by the Assessment) |
| **Closed** | Review concluded; Report generated | Reopened | Review Closed |
| **Reopened** | New Incident or Context reopens a closed question | Assessing | New Incident linked, or materially new Context |

Two rules govern all transitions: a Review can only move backward into **Assessing** — never directly into **Pending Decision** or **Decided** — because a Decision must always be re-grounded in a current Assessment; and **Closed** is never a dead end, because operational safety findings are, by nature, sometimes wrong in hindsight.

---

## 8. Canonical Context Model

The platform must be indifferent to where information came from. This is the single hardest constraint in the whole domain, and the reason Context exists as its own object rather than being scattered across provider-specific shapes.

Regardless of whether it originates from Manual Input, an enterprise system like SAP, a plant control system, a simulation, a spreadsheet import, a pull-based external source, or a live device feed — every piece of information must be translated into the same canonical shape before anything downstream is allowed to touch it. Conceptually, every unit of Context answers the same four questions, no matter its origin:

- **What is this a fact about?** — the Asset, Worker, or Incident it pertains to.
- **What kind of fact is it?** — its category (e.g., equipment state, environmental condition, personnel status, historical pattern), not its source system.
- **When is it valid?** — a timestamp and a validity window, since operational facts decay.
- **How much should it be trusted?** — a confidence or provenance indicator, since a manually typed note and a live sensor feed are not equally reliable, even once both are canonical Context.

An Operational Assessment is never allowed to reason directly over provider-specific data. If it did, swapping a Context Provider — plugging in a simulator where a real plant later goes, or vice versa — would require touching the domain itself, which is the exact failure mode this whole document exists to prevent.

---

## 9. Bounded Contexts

- **Operational Review** — Review, Assessment, Recommendation, Decision, Evidence, Review Participant. The core transactional heart of the product; everything else exists to feed it or react to it.
- **Context Ingestion** — Context itself, and the discipline of normalizing anything a provider sends into the canonical shape. Separated out because this is where the "Native First, integrations are optional" principle actually gets enforced — this context can gain or lose providers without the Operational Review context ever knowing.
- **Master Data / Registry** — Asset, Worker, Permit, Compliance Rule. Separated because these have their own owners, their own update cadence, and often their own external system of record; they must not be allowed to become an accidental extension of the Review context.
- **Incident Management** — Incident. Separated because Incidents have a life independent of Reviews — they are reported and investigated whether or not the platform ever opens a Review about them.
- **Compliance & Audit** — Audit Entry (and the versioned application of Compliance Rules as evidence). Separated because its integrity requirements — append-only, permanent, non-negotiable — are stricter than anything else in the system, and mixing it with operational contexts risks that strictness leaking or eroding.
- **Reporting & Notification** — Report, Notification. Separated from the core because both are purely reactive, downstream, and disposable in a way the core transactional objects are not: losing a Notification is an inconvenience; losing a Decision is not.
- **Visualization / Explanation** — no domain objects of its own. The Digital Twin is explicitly an explanation interface over the Operational Review and Context contexts, not a place where new domain concepts should be invented. It earns a bounded context anyway because it has a distinct concern (making the domain legible to a human) even though it owns nothing.

---

## 10. Open Questions

- **Is Recommendation pulling its weight as a separate object from Assessment?** It's justified here by an independent accept/reject lifecycle, but if in practice Recommendations are never referenced outside their parent Assessment, this may be over-modeling. Worth revisiting once real usage patterns exist.
- **Should Worker and Review Participant collapse into a single "Person" concept with contextual roles?** They're kept separate here because a Worker can be the *subject* of a Review (e.g., a safety concern about them) without ever being a *Participant* in it, and conflating those would blur a distinction the safety domain cares about. But this adds real complexity — it should be pressure-tested against actual scenarios, not just theory.
- **Does Permit belong in this domain at all, or is it purely someone else's master data that the platform should only ever see as Context?** As written, Permit is a first-class object with its own lifecycle here. An argument can be made that it should never be more than a Context category, with its "true" lifecycle owned entirely outside the platform. This is a real fork, not a stylistic one — it affects invariant 3 above materially.
- **Is Incident correctly modeled as independent of Review, or is that a false separation for this platform's actual use case?** Given the product is explicitly anchored to a compound-risk-detection use case, most Incidents in practice may only ever surface *through* a Review. If that turns out to be true, keeping Incident fully independent may be modeling for a generality the product doesn't actually need yet.
- **Escalation is under-specified.** The state machine allows it, but this document does not define who has authority to escalate, or what distinguishes an escalation from a routine re-assessment. That's arguably still domain-level, not implementation-level, and may deserve its own subsection before this document is considered final.
- **Report versioning on Reopen could get out of hand.** If Reviews reopen frequently, "a new Report every time" (Invariant 13) could produce report sprawl that undermines the "single source of truth" the Report is supposed to provide. Worth deciding now whether that's acceptable or whether Report needs a superseding relationship of its own, similar to Assessment.

This document should not be treated as settled simply because it is thorough. The open questions above are not rhetorical — they should block sign-off until answered, not follow it.
