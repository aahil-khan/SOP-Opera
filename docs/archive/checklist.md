# ET Hackathon Product Review Checklist

---

# A. Problem Validation

### □ Is the problem real?

Not hypothetical.

Can we cite real incidents or operational practices?

---

### □ Is it painful enough?

Would a plant manager actually care?

Or is it merely "nice to have"?

---

### □ Is the problem frequent?

Daily?

Weekly?

Or once every three years?

High frequency usually creates stronger business value.

---

### □ Is the problem expensive?

Does it cost

* lives
* downtime
* compliance penalties
* production loss
* insurance
* reputation

---

### □ Does existing software already solve it?

This is huge.

If SAP or Maximo already solve it well,

we shouldn't build it.

---

# B. User

### □ Can we name exactly ONE primary user?

Not

"Industry"

Not

"Factory"

Instead

* Shift Supervisor
* Safety Officer
* Control Room Operator

---

### □ Is there a secondary user?

Maybe

Plant Manager

Maintenance Engineer

Emergency Team

---

### □ Does the user naturally open this software?

Or are we inventing a workflow?

---

### □ At what exact moment do they use it?

This might be the single most important question.

---

# C. Workflow

### □ Can we describe today's workflow?

Step-by-step.

Without AI.

---

### □ Where does it currently fail?

Exactly where?

---

### □ Which systems are involved?

SCADA

SAP

Maximo

PTW

CCTV

etc.

---

### □ Which information is missing?

Not data.

Context.

---

### □ Where does human judgment begin?

That's usually where AI belongs.

---

# D. Product

### □ Can we explain the product in one sentence?

If not,

the product isn't clear enough.

---

### □ Is the product replacing software?

Or sitting above it?

We want the second.

---

### □ Does every feature support the core workflow?

If not,

remove it.

---

### □ Does every feature answer

"When would somebody use this?"

---

### □ Does the feature reduce cognitive load?

Or increase it?

---

# E. AI Justification

### □ Why is AI needed?

Would rules work?

Would SQL work?

Would search work?

If yes,

don't use AI.

---

### □ Which AI capability is being used?

Reasoning

Vision

Prediction

Summarization

Classification

etc.

---

### □ What data does AI combine?

Sensor

Permit

Maintenance

Weather

History

Workers

---

### □ Why couldn't a dashboard do this?

---

### □ Is the AI explainable?

Can the user understand

Why?

---

# F. Trust

### □ Is AI recommending?

Or deciding?

Recommendation wins.

---

### □ Can users override AI?

---

### □ Can users audit AI?

---

### □ Is confidence shown?

---

### □ Is reasoning shown?

---

# G. Enterprise Reality

### □ Could this integrate with

SAP

Maximo

SCADA

rather than replacing them?

---

### □ Does it respect OT/IT separation?

---

### □ Would a CTO believe this architecture?

---

### □ Would a plant manager believe this workflow?

---

### □ Is deployment realistic?

---

# H. Demo

### □ Is the first 10 seconds interesting?

---

### □ Does the judge interact immediately?

Instead of watching.

---

### □ Is there one memorable interaction?

Our AgriBloom moment.

---

### □ Does the digital twin explain something?

Not decorate.

---

### □ Is the value obvious without explanation?

---

### □ Would someone remember this tomorrow?

---

# I. Architecture

### □ Is every component necessary?

---

### □ Does the architecture follow the workflow?

Not the reverse.

---

### □ Is there a deterministic validation layer?

---

### □ Is AI isolated to the right place?

---

### □ Could we explain the architecture in under one minute?

---

# J. Business

### □ Who pays?

---

### □ Why would they buy?

---

### □ How do they measure ROI?

---

### □ What changes on Monday morning after deployment?

This is one of my favorite questions.

---

### □ Why wouldn't they just continue using existing software?

---

# K. Differentiation

### □ What will 90% of teams build?

---

### □ Are we accidentally building that?

---

### □ What's our unfair advantage?

---

### □ What's the one thing judges will remember?

---

### □ Is our story stronger than our architecture?

It should be.

---

# L. Demo Story

Can the demo be explained in exactly this structure?

```
Problem

↓

Current workflow

↓

Current failure

↓

Our product

↓

One interaction

↓

AI reasoning

↓

Recommendation

↓

Business outcome
```

If the demo deviates significantly from this, it's worth asking why.

---

# M. Scope

### □ Can we build this in 10 days?

---

### □ What absolutely must exist?

---

### □ What can be removed without hurting the core experience?

---

### □ If we lost 3 days, would the product still feel complete?

---

# N. "AgriBloom Test"

This is our final gate.

Ask these questions:

* □ Can I describe the product in one sentence?
* □ Can I explain it to a non-technical judge in under 30 seconds?
* □ Does it revolve around one core interaction?
* □ Does the AI solve a real problem instead of showcasing itself?
* □ Would the demo still be compelling if I hid the architecture slide?
* □ Is the product something an enterprise company like Octave could plausibly commercialize?

---

## One thing I'd add that's specific to this hackathon

Because this is an **Economic Times + Octave** hackathon, I'd add one final section that forces us to satisfy *both* audiences.

### O. Judge Alignment

#### Economic Times

* □ Is the human impact immediately obvious?
* □ Is the story compelling and easy to follow?
* □ Is the business value clear without technical knowledge?

#### Octave Research

* □ Does the workflow feel authentic to industrial operations?
* □ Does the architecture fit into an existing enterprise environment rather than replace it?
* □ Would an industrial CTO say, "Yes, this could actually be deployed"?

---

If we can consistently answer "yes" to nearly all of these questions for every iteration, I think we'll have a much stronger product than if we simply keep adding features. This checklist also gives us an objective way to critique our own work instead of relying on intuition alone.