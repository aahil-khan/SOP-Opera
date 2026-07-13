# System Interaction & Workflow Specification (SIWS)
### Operational Review Platform — v1.0

Companion to: PRD v3 (frozen), Canonical Domain Model v1.0 (frozen)
Precedes: Technical Design Specification
Status: Draft for engineering review

---

## 1. System Philosophy

The Canonical Domain Model defines nouns. This document defines verbs — what happens, in what order, and who is allowed to make it happen.

The platform's behavior is not a pipeline with a start and an end. It is a set of reactions to two kinds of input: **the world changing** (new Context arriving) and **a human acting** (a Decision, a reassignment, an escalation). Everything the platform does is one of those two things, or a downstream consequence of one of those two things. There is no third category of "the system decides to do something on its own" — the AI produces Assessments in response to a request from the Review, never on its own initiative, and the platform never acts on the physical world at all.

This behavior is the same regardless of what stores it, what triggers the reaction, or what shows it to a human. If a behavior described here can only be explained by referring to a queue, a job scheduler, or a specific transport mechanism, it does not belong in this document — it belongs in the Technical Design Specification. Every sentence below should survive being read by someone who will never see the eventual implementation.

---

## 2. Happy Path

**Creation.** An Operational Review opens. It always opens with a reason — a triggering Context, a triggering Incident, or a direct human request — and it always opens with exactly one Owner assigned, per the Canonical Domain Model's invariant.

**Context collection.** The moment a Review opens, it becomes eligible to draw on Context concerning its Asset (and, where relevant, its Workers, Permits, and any linked Incident). This is not a discrete "step" that finishes — Context keeps arriving for as long as the Review stays open. What changes is only whether the platform judges the currently available Context sufficient to request an Assessment.

**Assessment.** The Review requests an Assessment. The AI consumes whatever Context is currently valid, produces a risk judgment, and proposes zero or more Recommendations. This is the only point in the entire lifecycle where the AI acts — it never initiates, and it never decides.

**Decision.** A human holding the active Decision Maker role reviews the Assessment, accepts or rejects each Recommendation individually, and submits a Decision. The moment a Decision is submitted, the Evidence it relied on — the specific Context and Assessment it was grounded in — is frozen, permanently.

**Execution.** Whatever the Decision authorized happens in the physical world. This step is explicitly outside the platform's ownership. The platform records that a Decision was made; it does not carry it out and does not track its physical completion, beyond receiving updated Context if and when the world reports back.

**Closure.** Once the Decision has been submitted and nothing about the Review remains open, the Review closes.

**Reporting.** Closure generates a Report — an immutable narrative snapshot of the Review as it stood at the moment it closed.

**Audit.** Every one of the above steps has already been recording an Audit Entry as it happened, not as a separate step performed at the end. Audit is not a stage; it is a continuous byproduct of everything else in this list.

---

## 3. Alternate Flows

**Missing Context.** A Review can be asked to produce an Assessment with incomplete Context. The domain does not block this — an Assessment made on partial information is still a valid Assessment, provided the Recommendation and Decision layers can see how confident that Assessment was. What the domain does not permit is silently treating missing Context as a negative signal; absence of Context is not evidence of safety.

**Assessment Failure.** If the AI cannot produce a usable Assessment (for whatever reason — this document doesn't speculate on cause, only on domain consequence), the Review remains in Assessing. It does not advance, and it does not fall back to a prior Assessment automatically. A stalled Review is a visible, honest state; a Review must never appear to have progressed to Pending Decision without a genuine Assessment behind it.

**New Context arrives while Pending Decision.** If Context materially relevant to an already-Complete Assessment arrives before a Decision is submitted, the Review returns to Assessing and a new Assessment is requested. The old Assessment is not deleted — it is Superseded and retained. A Decision Maker must never be allowed to decide against an Assessment the domain already knows is stale.

**Recommendation rejected.** Rejection is a first-class, ordinary outcome — not an error state. A rejected Recommendation is recorded exactly as durably as an accepted one; the Decision that rejected it is the object of record for why.

**Escalation.** At any point between Pending Decision and Decided, a Review can move to Escalated instead — either because a human with escalation authority invokes it, or because the Assessment itself signals a risk level the current Decision Maker isn't authorized to close alone. Escalation changes who may submit the Decision. It never removes the requirement for one.

**Review Reopened.** A Closed Review can reopen. Reopening never edits anything that already happened — it begins a new Assessing cycle, with the entire prior history (Assessments, Decisions, Evidence, the original Report) preserved and visible as historical context for the new cycle.

**Incident linked after closure.** An Incident discovered or reported after a Review has already closed can still be linked to it. This does not reopen the Review by itself — linking and reopening are separate acts. A closed Review can accumulate Incident links indefinitely, purely as historical record, without ever coming back to life.

---

## 4. Object Responsibilities During Each Stage

| Stage | Active object | Object(s) that change | Object(s) immutable at this stage | Who owns the transition |
|---|---|---|---|---|
| Creation | Operational Review | Review (Opened), Review Participant (Owner assigned) | — | The Platform |
| Context collection | Context | Context (continuously ingested) | Prior Evidence, prior Reports | The Platform |
| Assessment | Operational Assessment | Assessment (Generating → Complete), Recommendation (Proposed) | Context already frozen into prior Evidence | The AI |
| Decision | Decision | Decision (Submitted), Recommendation (Accepted/Rejected), Evidence (Captured) | The Assessment being decided on | The Human (Decision Maker) |
| Execution | *(outside the domain)* | — | Everything already recorded | Outside the platform entirely |
| Closure | Operational Review | Review (→ Closed) | Decision, Evidence | The Platform, following a submitted Decision |
| Reporting | Report | Report (Generated) | The Review state it summarizes | The Platform |
| Audit | Audit Entry | Audit Entry (Recorded, continuously) | Itself, permanently, from the instant of recording | The Platform |

The pattern worth naming explicitly: the AI is only ever the active party during Assessment. The Human is only ever the active party during Decision. Every other stage is owned by the Platform acting as custodian, not as a decision-making party in its own right.

---

## 5. Domain Conversations

**Operational Review requests Assessment.** The Review, on entering Assessing, is the party that initiates this — never a human directly, and never the AI on its own. This preserves the principle that Assessments are always grounded in a specific Review's current state, not produced speculatively.

**Assessment consumes Context.** The Assessment reads whatever Context is currently valid for the Review's Asset (and linked Worker, Permit, Incident). It has no visibility into where any individual piece of Context originated — only into the canonical shape defined in the Canonical Domain Model.

**Assessment generates Recommendations.** Zero or more Recommendations come out of a single Assessment. They are proposals, not instructions — nothing about their existence obligates any Decision.

**Decision consumes Assessment.** A Decision cannot be submitted without referencing a Complete Assessment that has not since been Superseded. This is the conversation that enforces the human/AI boundary at the moment it matters most.

**Evidence becomes frozen.** The instant a Decision is submitted (or, in some cases, the instant an Assessment is Completed — see Section 7), the specific Context relied upon stops being live and becomes Evidence. This is a one-way conversation: Evidence never talks back to Context.

**Report consumes Review history.** Report generation reads the full accumulated history of a Review — its Assessments, Decision, Evidence, and Audit trail — at the moment of Closure, and produces a static narrative. It does not maintain a live connection back to the Review afterward.

**Notification reacts to Domain Events.** Every event listed in the Canonical Domain Model is a potential trigger for a Notification. This conversation only ever flows one direction — from event to Notification — and a Notification can never be the origin of a state change.

---

## 6. Review Lifecycle Walkthrough — Hot Work Review

A permit request arrives for hot work (welding) near a vessel known to have handled flammable material.

**1. Trigger.** The Permit request itself, surfaced as Context, is sufficient cause to open an Operational Review. The Review opens against the relevant Asset (the vessel and its surrounding work area), with the requesting site's Safety Lead assigned as Owner.

**2. Context collection.** Several independent facts become available as Context: the Permit's requested time window and scope; the most recent readings associated with the Asset; the certification status of the Workers named on the Permit; and, separately, historical Incident records associated with similar hot-work activity on this Asset or similar ones. None of these facts know about each other yet — they are simply available.

**3. Assessment requested.** The Review enters Assessing and requests an Assessment.

**4. Assessment produced.** The AI synthesizes the available Context. It identifies that a recent reading near the Asset is close to a threshold that, combined with hot work, has historically preceded Incidents of this category. It produces an elevated risk Assessment and two Recommendations: require continuous monitoring during the work window, and restrict the work window to a period when the reading trend is favorable. It also surfaces, but does not recommend against, the fact that one named Worker's certification is close to expiry.

**5. Pending Decision.** The Review moves to Pending Decision. The Safety Lead, as Decision Maker, reviews the Assessment.

**6. Decision.** The Safety Lead accepts both Recommendations and additionally requires the near-expiry certification be renewed before work begins — a condition of their own, not something the Assessment proposed. They submit the Decision. At this instant, the Context relied upon is frozen into Evidence.

**7. Closure.** With a Decision submitted and no open questions remaining, the Review closes.

**8. Reporting.** A Report is generated, capturing the Assessment, the Recommendations, which were accepted, the Safety Lead's added condition, and the final authorization.

**9. Audit.** Every step above has already produced its own Audit Entry — the Review opening, each Context ingestion, the Assessment's completion, both Recommendation dispositions, the Decision submission, and the closure itself.

**10. Weeks later.** An unrelated Incident occurs elsewhere on the same Asset. During investigation, the Incident is linked back to this closed Review — not because the Review caused it, but because the historical pattern is now part of the record that future Assessments on this Asset will be able to draw on as Context. The Review itself does not reopen. Its history simply became slightly more valuable to everything that comes after it.

---

## 7. Context Lifecycle

Context enters the platform continuously, from any provider, in the canonical shape defined by the Canonical Domain Model. There is no batch or session — a Review that has been open for months is still receiving Context on its last day exactly as it did on its first.

Context becomes **stale** when its validity window lapses. Staleness is not deletion — stale Context remains part of the historical record, but it stops being eligible as an input to a new Assessment. A Review may still show a human what stale Context existed, but the AI is never permitted to reason over it as if it were current.

Context becomes **Evidence** only when something cites it — specifically, when an Assessment is Completed using it, or when a Decision is submitted relying on it. Context that is never cited by anything simply ages into staleness and is never promoted to Evidence. This is intentional: Evidence is not "all Context that existed," it is "the specific Context someone or something actually relied on."

Context can **trigger a reassessment** any time it arrives while a Review is Pending Decision, provided it is materially relevant to that Review's Asset, Worker, or Incident. What counts as "materially relevant" is judged by the AI at Assessment time, not decided in advance by a fixed rule — this document does not attempt to enumerate which categories of Context always warrant reassessment, because that judgment is itself part of what the Assessment is for.

---

## 8. Assessment Lifecycle

**Generation** begins only when a Review requests it. An Assessment is never produced speculatively or in advance of a Review needing it.

**Completion** is the point at which the Assessment's judgment and Recommendations are finalized and become visible to the Decision layer. Once Complete, an Assessment's content never changes.

**Superseding** happens when new material Context arrives before a Decision is submitted against the current Assessment. The old Assessment is marked Superseded, not deleted, and a new Assessment is requested in its place. A Superseded Assessment can never be the basis of a new Decision, even if a human wanted to use it.

**Invalidation** is conceptually distinct from staleness of the Context underneath it — an Assessment itself does not "go stale" on a timer the way Context does. It only ever becomes invalid for one specific reason: the arrival of new material Context, which is exactly what triggers Superseding. There is no separate decay clock on Assessments themselves.

**Historical preservation** applies to every Assessment a Review ever produces, Complete or Superseded. None are ever deleted. A Review's full Assessment history is part of what makes its eventual Report and Audit trail meaningful.

**Relationship with Decisions** is strictly one-directional and time-bound: a Decision may only ever reference the single Complete, non-Superseded Assessment that exists at the moment of submission. This is the mechanical enforcement of "the AI owns the Assessment, the Human owns the Decision" — a Decision is always answering a specific, current question, never a stale one.

---

## 9. Decision Lifecycle

**Submission** is the only meaningful state a Decision has — there is no domain-visible draft. A Decision Maker forms their judgment outside the domain's concern; the domain only becomes aware of a Decision at the moment it is submitted, complete and final.

**Acceptance of Recommendations** happens as part of submission, not before it. A Decision Maker cannot accept a Recommendation independently of submitting a Decision — acceptance has no meaning outside that act.

**Rejection** is recorded with equal weight to acceptance. The domain does not treat a rejected Recommendation as a lesser or incomplete outcome; it is a resolved one.

**Escalation** interrupts the Decision lifecycle before submission, not after. Once a Decision is submitted, it is final — escalation cannot be applied retroactively to a Decision that already exists. If a submitted Decision turns out to need higher authority in hindsight, the correct behavior is a new Review cycle (via Reopening), not a revision of the original Decision.

**Closure** follows directly from submission whenever nothing else about the Review remains open. A Decision does not itself close a Review — it makes the Review eligible for closure, which is still the Review's own transition to make.

**Relationship with Assessments** mirrors Section 8: a Decision always points to exactly one Assessment, and that pointer is permanent. If the Review is later Reopened and produces new Assessments, the original Decision's reference to the original Assessment is untouched.

---

## 10. Report Lifecycle

A Report is generated exactly once per closure event — not once per Review. A Review that closes, reopens, and closes again produces two Reports, each an honest snapshot of its respective closure.

New Report versions are never produced by editing an existing Report. If something about a closed Review needs updating, that need can only be met by generating a genuinely new Report, timestamped after the old one, never by mutating the old one in place. A Report a human already read and relied on must never change out from under them.

**Reopening's effect on Reports** is deliberately indirect: reopening does not touch the existing Report at all. It only becomes relevant to reporting again when the Review reaches its next Closure, at which point a new Report is generated describing the full history — the original cycle and the new one — as it now stands. The original Report remains exactly as it was, a permanent record of what was known and decided the first time around.

---

## 11. Notification Behavior

The events that warrant a Notification are, conceptually, the ones that change what a human needs to know or do:

- A Review is opened and assigned to them as Owner.
- An Assessment completes and a Decision is now needed.
- A Recommendation they proposed (conceptually — on the AI's behalf) is accepted or rejected, where that matters to a downstream stakeholder.
- A Review is escalated, and escalation authority now rests with them.
- A Review they own is Reopened.
- An Incident is linked to a Review they were involved in.
- A Report is generated for a Review they participated in.

Recipients, conceptually, are always determined by a person's *current relationship to the Review* — its active Owner, its active Decision Maker, or a Participant whose role makes an event relevant to them — never by a static distribution list unrelated to the Review's own participant model.

This document deliberately says nothing about how notifications are delivered, batched, or prioritized. Those are legitimate concerns, but they are Technical Design Specification concerns, not domain behavior.

---

## 12. Failure & Recovery

**The AI fails to produce an Assessment.** The Review remains in Assessing. It does not silently advance, does not fall back to a stale Assessment, and does not close. The domain's only obligation here is honesty about state — a Review that cannot be assessed is visibly a Review that cannot be assessed.

**Context disappears** — a provider stops supplying it. Already-ingested Context is unaffected; it continues its normal path toward staleness on schedule. The absence of *new* Context is not itself a signal the domain interprets as anything — it is simply an absence, and the Assessment layer must reason with whatever remains valid.

**An Assessment becomes stale relative to new Context** before a Decision is submitted. This is not a failure — it is the ordinary Superseding behavior described in Section 8, working as intended.

**Review ownership changes** mid-Review — the active Owner is reassigned. The outgoing Owner's Participant assignment is Released; the incoming Owner's assignment becomes Active. Nothing about the Review's Assessments, Decisions, or Evidence is affected. The domain does not require the new Owner to "catch up" through any special mechanism — the full history is equally visible to whoever holds the role at any given moment.

**A Review is reopened months later.** All original Assessments, Decisions, and Evidence remain exactly as they were, permanently. A new Assessing cycle begins, and the AI producing the new Assessment has the entire original history available as Context — the platform does not pretend the first cycle didn't happen. The only genuinely open question this raises, and one this document does not resolve, is what happens if the Asset, Worker, or Compliance Rule referenced by the original Review no longer exists in its original form by the time of reopening. See Section 15.

---

## 13. Behavioral Invariants

These govern how objects are allowed to interact over time — distinct from the static Domain Invariants already defined in the Canonical Domain Model.

1. A Decision can never exist without referencing a Complete, non-Superseded Assessment at the moment of submission.
2. Evidence can never change after capture, including during a later Reopen cycle.
3. Reopening a Review never destroys, hides, or overwrites any prior Assessment, Decision, Evidence, or Report — it only ever adds a new cycle on top of the existing history.
4. A Recommendation can only be Accepted or Rejected as part of an actual Decision submission — never as a standalone act.
5. A Notification can never alter Review state. Any human response to a Notification must flow back through a real domain action (a Decision, a reassignment, an escalation) to have any effect.
6. An Assessment can only be requested by a Review entering Assessing — never invoked directly by a human bypassing the Review.
7. Context that arrives after a Decision has been submitted can never retroactively alter that Decision or the Evidence it froze.
8. Escalation changes who may submit a Decision. It never removes the requirement that one still be submitted.
9. A Report is generated exactly once per closure event, and a closure event happens at most once per Review lifecycle cycle — reopening starts a new cycle rather than repeating the old one.
10. Ownership of a Review (the active Owner role) is never vacant during an open Review, even momentarily during reassignment — the outgoing and incoming assignments are treated as a single atomic transition at the domain level.

---

## 14. Sequence Narratives

**Review Creation**
Trigger occurs (Context or Incident or direct request) → Review opens → Owner assignment created → Audit Entry recorded.

**Assessment Generation**
Review enters Assessing → Assessment requested → AI consumes currently-valid Context → Assessment reaches Complete → Recommendations proposed → Audit Entries recorded for each → Review advances to Pending Decision.

**Context Update (mid-Pending-Decision)**
New Context arrives → judged materially relevant to the current Assessment → Review returns to Assessing → current Assessment marked Superseded → new Assessment requested (repeats "Assessment Generation" above).

**Recommendation Acceptance**
Decision Maker reviews Assessment → forms judgment (outside domain visibility) → submits Decision → Recommendation(s) marked Accepted or Rejected as part of that same submission → Evidence frozen → Audit Entry recorded.

**Escalation**
Review reaches Pending Decision → escalation triggered (human-initiated or Assessment-signaled) → Review moves to Escalated → Decision authority transfers to an escalation-authorized Participant → Decision proceeds as normal from there.

**Review Closure**
Decision submitted → no further open questions remain → Review moves to Closed → Report generated from full Review history → Audit Entry recorded for closure.

**Review Reopening**
New Incident or materially new Context arrives against a Closed Review → Review moves to Reopened → immediately re-enters Assessing → prior history remains fully intact and visible → cycle proceeds as in "Assessment Generation."

**Incident Linked After Closure**
Incident reported or discovered → judged relevant to a Closed Review → link created between Incident and Review → Audit Entry recorded → Review state itself is unaffected.

---

## 15. Edge Cases

- **Conflicting Context arriving simultaneously.** If two providers supply materially conflicting facts about the same Asset at effectively the same moment, this document does not define which one the Assessment should trust, or whether both should simply be presented with their respective confidence indicators and left for the Assessment to weigh. This is a real gap, not an oversight to paper over.
- **A Decision submitted just as a Superseding Context arrives.** There is an inherent race between "Context arrives, Assessment gets Superseded" and "Decision Maker submits against the still-Complete Assessment." Behavioral Invariant 1 says a Decision must reference a non-Superseded Assessment — but this document does not define which event is considered to have happened first when they are near-simultaneous. This needs an explicit answer before implementation, not an assumed one.
- **Reopening a Review whose Asset has since been decommissioned.** The Canonical Domain Model guarantees an Asset's identity remains stable after decommissioning, but this document does not define whether a decommissioned Asset can still be meaningfully reassessed, or whether Reopening should be blocked, or produce a different kind of cycle entirely.
- **A Recommendation is accepted, but nothing confirms it was carried out.** By design, the platform does not track physical execution. For a general-purpose review platform this is defensible. For a compound-risk-detection use case specifically, this may be a real gap — the platform's ability to detect an emerging pattern is weaker if it never learns whether an accepted Recommendation actually happened. This is flagged, not resolved, here.
- **A Compliance Rule cited in an open Review's Evidence is retired mid-Review.** Evidence is immutable, so the citation itself doesn't change — but this document does not say whether an in-progress Review should be prompted to re-check itself against the rule's replacement before it closes.
- **One Incident triggers multiple simultaneous Reviews** against different Assets. Nothing in this model or the Canonical Domain Model prevents this, but the relationship between those sibling Reviews — whether they should be aware of each other, whether a Decision on one should influence the Assessment of another — is entirely undefined.
- **Escalation trigger ambiguity, carried forward from the Canonical Domain Model's open questions.** Both human-initiated and Assessment-signaled escalation are allowed here, but this document does not resolve what happens if both occur for the same Review in close succession, or which one takes precedence.
