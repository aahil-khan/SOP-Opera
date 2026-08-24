# Shift Handover — complete guide

Everything on `/handover`: what each element is, where its number comes from, and why the
page exists at all. Written to be read start-to-finish once, then used as a lookup.

Every claim below carries a `file:line`. If something here disagrees with the code, the code wins.
Bare backend filenames (`service.py`, `composer.py`, `repository.py`, `narration.py`, `routes.py`,
`schemas.py`) mean `backend/app/handover/…`; bare `HandoverView.tsx` / `HandoverLedger.tsx` mean
`frontend/components/handover/…`. Anything else is spelled out in full.

---

## 1. Why this page exists

The premise the whole product is built on (`docs/archive/problem statement.md`) is that in
incidents like the Visakhapatnam coke-oven explosion **the information existed but never reached
the person who could act on it**. The shift boundary is where that failure happens most often —
Piper Alpha is the textbook case: a permit-to-work condition that did not survive the changing of
the guard.

So this page treats a shift change as an **accountable act, like a decision** — not a clipboard,
not a summary email:

> A named outgoing operator issues a carry-forward list to a named incoming operator, who must
> acknowledge every high-risk item before taking custody.

That framing is stated in the schema comment itself (`backend/app/db/schema.sql:388-395`) and in
the service docstring (`backend/app/handover/service.py:1-9`).

The forcing function is `accept()` (`backend/app/handover/service.py:444`): it **refuses** while any
item marked `requires_ack` is still pending. As that docstring puts it — *"a brief nobody has to
acknowledge is just a summary."*

**Three properties make it more than a form:**

| Property | Where |
| --- | --- |
| What carries is decided by **deterministic rules**, never the LLM | `backend/app/handover/composer.py:1-9` |
| Custody transfer is **hash-chained into the audit log** | `service.py:295`, `:360`, `:473` → `audit/service.py` |
| A missed acknowledgement **feeds back into the AI risk verdict** | `unacknowledged_handover`, §9 below |

That third one is the part judges tend to miss: this isn't a side-panel. A hazard that crossed a
shift boundary unread changes what the assessment engine says about that asset the next time
context arrives.

---

## 2. Where it lives

| Layer | Path |
| --- | --- |
| Route | `/handover` → `frontend/app/handover/page.tsx` (7 lines, renders `HandoverView`) |
| Main component | `frontend/components/handover/HandoverView.tsx` (555 lines) |
| Ledger component | `frontend/components/handover/HandoverLedger.tsx` (295 lines) — reused by the twin gate |
| Styles | `frontend/components/handover/Handover.module.css` (904 lines) |
| Second surface | `frontend/components/twin/ShiftGate.tsx` — modal over `/operator` (§8) |
| Nav entry | `frontend/components/nav/TopNav.tsx:105-109` ("Shift Handover") |
| Backend domain | `backend/app/handover/` — `routes · service · repository · composer · narration · schemas` |
| Tables | `handovers`, `handover_items` — `backend/app/db/schema.sql:396-459` |
| Contracts | `shared/schemas.ts:452-543` (TS) · `backend/app/handover/schemas.py` (Python) |
| Tour step | Act VII "Custody, not a clipboard." — `frontend/lib/tourScript.ts:608-617` |

---

## 3. The lifecycle

```
                 compose_carry_forward()          incoming acknowledges
                 + narrate()                       every required item
   (nothing) ──────────────────────▶ draft ──────▶ issued ──────────────▶ accepted
                 POST /handover/draft   POST      POST .../accept
                                       .../issue     ▲
                                                     │ refused while
                                                     │ outstanding > 0
                                                     │
                     any active handover ────────▶ expired
                     when a new draft opens
```

Four states, declared in one place each: `schemas.py:11` (Python), `shared/schemas.ts:459` (TS),
`schema.sql:408` (DB default + comment).

| State | Meaning | Who can act |
| --- | --- | --- |
| `draft` | Outgoing operator is still editing the list — pruning items, adding notes | outgoing only |
| `issued` | Handed over. The clock is running; items await acknowledgement | incoming only |
| `accepted` | Custody transferred. Every required item was cleared, by construction | nobody — settled |
| `expired` | Superseded by a newer handover before it was accepted | nobody — settled |

**`expired` is not a soft-delete.** Its unacknowledged items stay visible in
`GET /handover/gaps` (`repository.py:fetch_gaps`, filters `h.state IN ('issued','expired')`) and
still count as `unacknowledged_crossings` in the metrics. As `service.py:210-212` states: *an
abandoned handover is itself a handover failure.*

**Only one handover may be in flight at a time.** Enforced by a partial unique index,
`uq_handovers_active` (`schema.sql:457-459`), over the constant expression `(state IS NOT NULL)`
restricted to `state IN ('draft','issued')` — a roundabout way of writing "at most one row". The
reason is in the comment at `schema.sql:449-452`: two operators ending their shift concurrently
would each compose a list from the same window and split custody in half, with neither list
complete.

When you open a new draft, `expire_stale_active()` (`repository.py`) retires the previous one
rather than refusing — so a stale draft can never wedge the feature (`service.py:208-213`).

---

## 4. Who sees what — `viewer_role`

**This page has no tabs.** Which controls you get is decided by the *server*, from your signed-in
actor cookie, and returned as `viewer_role` (`service.py:92-99`):

| `viewer_role` | You are | What you can do |
| --- | --- | --- |
| `outgoing` | The operator handing over | Edit the draft, remove items, add notes, **Issue** |
| `incoming` | The operator taking over | **Acknowledge** / **Query** each item, **Accept shift** |
| `observer` | Everyone else — including the supervisor | Read only |

The component comment at `HandoverView.tsx:24-31` says why: *"Custody has two ends and you are only
ever standing at one of them."*

Two derived booleans drive the entire UI (`HandoverView.tsx:99-101`):

```ts
const canEdit        = handover.state === "draft"  && role === "outgoing";
const canAcknowledge = handover.state === "issued" && role === "incoming";
const outstanding    = handover.required_total - handover.required_cleared;
```

**Supervisors are never a party.** `seed.py:19-21` spells it out: the supervisor (`OWNER_ID`)
decides; nobody hands a decision-maker a shift. Custody passes between the two seeded panel
operators — **Meera (Panel Operator · A)** and **Arun (Panel Operator · B)** (`seed.py:23-25`).
The roster dropdown filters accordingly (`HandoverView.tsx:442-447`: `kind === "user"`, excluding
yourself), and the server independently rejects self-handover (`service.py:200-201`).

`GET /handover/current` is readable **without** signing in — `viewer_role` just falls back to
`observer` (`routes.py:29-31`). So a projector or a judge's browser can watch without auth.

---

## 5. Page anatomy — element by element

The page renders in one of **two shapes**, chosen at `HandoverView.tsx:80`: if there is no handover,
or the latest one is `accepted`/`expired` (`settled`), you get the **idle shape**. Otherwise the
**active shape**.

### 5a. Idle shape (no handover in flight)

**Page header** (`HandoverView.tsx:248-266`) — `Shift handover`, with the standing subtitle:
*"Everything the outgoing operator is still holding, transferred to a named incoming operator who
must acknowledge each hazard before taking the plant."* The `You are {role}` chip is suppressed for
observers.

**Idle hero** (`:288-303`) — a status block with a pulsing dot. Reads *"Checking for an active
handover…"* while loading, then *"No active handover"* plus a line explaining that one will appear
here the moment it is issued to you.

**Settled summary** (`:408-421`) — only when the *last* handover finished. One sentence of history,
plus a badge:
- accepted → *"Arun took custody from Meera, acknowledging N items."*
- expired → *"A handover from Meera was superseded before Arun accepted it. Its unacknowledged
  items remain open gaps."*

**"End your shift" composer** (`:423-498`) — three controls:

| Control | What it does |
| --- | --- |
| **Incoming operator** (select) | Roster of users other than you (`:442-447`) |
| **Look back (hours)** (number, 1–72, default 12) | How far back to scan for items to carry |
| **Compose handover** (button) | `POST /handover/draft` → builds the list and drafts it |

⚠️ **The "look back" field is the single most misread control on the page.** Its tooltip
(`:480`) is explicit: *"How far back to scan for open items to carry forward. It is not the length
of the shift you worked, nor how long the handover stays open."* It is a **query window**, not a
shift length and not an expiry. The bounds `ge=1, le=72` are validated server-side
(`schemas.py:HandoverDraftIn`).

It does **not** apply uniformly, either — see §6: open reviews and open tasks ignore it entirely.

### 5b. Active shape (draft or issued)

Layout: a full-width **hero stat row**, then two columns — the **ledger** (main) and the **rail**
(aside).

#### The hero stat row (`ActiveHero`, `:305-353`)

Four tiles. Each has a value, a label, and a hover hint. Colour comes from a `data-tone` attribute
(`Handover.module.css:199-231`).

| Tile | Value | Tone rules |
| --- | --- | --- |
| **State** | `draft` / `issued` | good if accepted, bad if expired, else **warn** (`:312-317`). Hint shows `Outgoing → Incoming` |
| **Required** | `required_total` — items that must be acknowledged before custody transfers | always neutral |
| **Cleared** | `required_cleared` — acknowledgements already signed | good when nothing outstanding (`:318-323`) |
| **Outstanding** | `required - cleared` — *"Still blocking Accept shift"* | good at 0, **bad above 3**, warn between (`:324`) |

`required_total` / `required_cleared` are computed server-side, not in the browser
(`service.py:134-135`), so the number in the tile is the same number the accept gate enforces.

#### Shift narration (`:112-135`)

The prose paragraph at the top of the ledger column — one short summary of the whole list.

Next to the heading is the **narration mode chip**, and it is deliberately honest about provenance
(`narration.py:8-16`, chip at `HandoverView.tsx:116-131`):

| Chip text | `narration_mode` | Means |
| --- | --- | --- |
| `model narration` | `llm` | A live model returned usable prose |
| `template narration · no LLM configured` | `deterministic` | `AI_PROVIDER=mock` (the default) — **no model was contacted at all** |
| `template narration · LLM call fell back` | `fallback` | A model *is* configured but the call failed or returned empty; the template ran instead. Tooltip points you at the API log line `handover narration failed` |

**Why three modes and not two:** a supervisor must be able to tell a written brief from a canned
one, and — critically — must be able to tell a *deliberate* template from a *silent failure*
(`narration.py:15-16`). Most demos run in `deterministic`.

**The model never chooses what carries.** It only narrates a list already fixed by
`composer.py`. That is the same division the assessment pipeline keeps between the LLM's `summary`
and the policy's `risk_level`. Consequence, stated at `composer.py:5-9`: *a provider outage can
degrade the prose but can never silently drop a hazard out of the handover.* The prompt itself
(`narration.py:108-117`) caps at 90 words, forbids inventing hazards/numbers/regulations, and is
fed at most 25 items per group (`_MAX_PROMPT_ITEMS`, `:28`).

#### The carry-forward ledger (`HandoverLedger.tsx`)

Items are split into exactly **two groups**, because that is the only distinction the incoming
operator has to act on (`HandoverLedger.tsx:7-13, 56-57`):

- **Must acknowledge** (`requires_ack === true`) — with a count chip, and an
  **Acknowledge all (N)** shortcut that appears only when you can acknowledge and more than one
  item is still pending (`:81-92`). That maps to one bulk SQL statement, not N requests
  (`repository.py:acknowledge_all_pending`).
- **For awareness** (`requires_ack === false`) — informational; no buttons.

**Empty state** (`:60-70`): *"Nothing is carried forward. No open reviews, active facts, outstanding
tasks, or live approval conditions."* — it names the four sources it checked, rather than just
saying "empty".

**Anatomy of one item card** (`HandoverItemCard`, `:150-256`):

| Element | Source | Notes |
| --- | --- | --- |
| **Type label** | `TYPE_LABELS[item_type]` (`:15-22`) | "Open review", "Active fact", "Outstanding task", "Approval condition", "Automatic response", "Operator note" |
| **Title** | `item.title` | Snapshotted at compose time |
| **Risk badge** | `item.risk_level` | The global `badge` component, shared with the rest of the app |
| **Detail** | `item.detail` | One line of context — assignee, timestamp, source review |
| **Hazard dimension chips** | `item.hazard_dimensions` (`:181-189`) | Underscores → spaces. See §7 |
| **Signed line** | shown once `ack_state !== "pending"` (`:191-197`) | *"Acknowledged by Arun"* or *"Queried by Arun — “…”"* |
| **Show on twin** | when `asset_id` is set (`:200-208`) | Selects the asset and routes to `/operator` (`HandoverView.tsx:67-73`) |
| **Not relevant** | `canEdit` only (`:209-218`) | Prunes an auto-composed item from the draft |
| **Query** / **Acknowledge** | `canAcknowledge` and not yet cleared (`:219-238`) | Query opens an inline box |

The card is tinted by risk **and** by type via data attributes
(`Handover.module.css:561-583`): `data-risk` gives the left-edge colour, `data-type` distinguishes
facts/reviews/tasks, and `data-cleared="true"` visibly dims a signed item — *so the list drains as
the shift starts* (`HandoverLedger.tsx:11-12`).

**Acknowledge vs Query** — two ways to clear an item, both recorded:
- **Acknowledge** → `ack_state = "acknowledged"`. Plain "I have read and accept this."
- **Query** → `ack_state = "queried"` plus a free-text note, e.g. the placeholder's *"Was the
  isolation actually verified before you left?"* (`QueryBox`, `:258-295`).

Both count as *cleared* for the accept gate (`ack_state != "pending"`, `service.py:135`) — a query
is an on-record challenge, not a refusal. The query count is separately recorded in the accept
audit payload (`service.py:482-484`), so "accepted, but with three open questions" is recoverable.
The query box animates open with a `0fr → 1fr` grid trick so no height measuring is needed
(`HandoverLedger.tsx:241`).

#### The right rail

**Party strip** (`PartyStrip`, `:355-383`) — Outgoing → ↓ → Incoming, with `data-you` highlighting
your side, and a state badge. That badge reuses the app-wide risk vocabulary via
`badgeRiskForState` (`:386-390`): `accepted → nominal` (green), `expired → blocking` (red),
`draft`/`issued` → `elevated` (amber). An in-flight handover is deliberately *not* green.

**Acknowledgement progress** (`:170-179`, `ProgressPips` `:392-406`) — "N of M cleared" plus a row
of pips, one per required item, filled left to right (`Handover.module.css:417-425`). With nothing
required, it says *"Nothing requires acknowledgement."* rather than showing an empty bar.

**Add a note** (`AddNote`, `:500-555`, `canEdit` only) — title + optional detail + a
**Require acknowledgement** checkbox (default **on**). The subtitle names its purpose exactly:
*"Anything the system cannot see — a smell, a contractor still on site, a gauge you do not trust."*
This is the human channel; everything else on the list is machine-composed. Notes land with
`source = "manual"` and `item_type = "note"` (`repository.py:insert_note`), always appended last.

**Primary control** — one button, whichever applies:
- `canEdit` → **Issue to {incoming name}** (`:196-205`)
- `canAcknowledge` → **Accept shift**, disabled while `outstanding > 0`, with the explicit reason
  underneath: *"N items still need acknowledgement before you can take custody."* (`:207-224`)

**Role notes** — an observer sees *"You are reading this handover, not party to it."* (`:226-234`);
the outgoing operator on an issued handover sees *"Waiting for them to acknowledge and take
custody."* (`:236-241`). Nobody is left looking at a disabled button with no explanation.

---

## 6. Where the items come from — the composer

`compose_carry_forward()` (`composer.py:49-78`) runs **five** independent SQL queries and unions the
results. This is the substance of the page; everything above is presentation.

| # | Item type | Source | Which rows | `risk_level` | `requires_ack` when | Uses the window? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `open_review` | `reviews` + latest complete assessment (`:81-135`) | every review `state <> 'closed'` | that assessment's risk | risk is `elevated`/`blocking` | **No** |
| 2 | `response_action` | `response_actions` + `response_devices` (`:137-206`) | `status='active' AND tier>0` | `elevated` (tier 1) / `blocking` (tier 2+) | **always** | **No** |
| 3 | `active_fact` | `derived_facts` (`:208-270`) | newest per (asset, fact_type), value still true | `elevated` if it supplies a hazard dimension, else `nominal` | it supplies a dimension | **Yes** |
| 4 | `open_task` | `review_tasks` (`:272-321`) | `status IN ('open','acknowledged')` | `blocking` if `task_type='unblock'`, else `nominal` | it is an `unblock` task | **No** |
| 5 | `decision_condition` | `decisions` (`:323-374`) | `outcome='approved_with_conditions'`, non-empty conditions | `elevated` | **always** | **Yes** |
| 6 | `note` | typed by the operator (`repository.py:insert_note`) | — | `nominal` | operator's checkbox | n/a |

Each rule's reasoning, from the docstrings:

1. **Open reviews** — *"A review that has not been decided is unfinished work by definition, so it
   carries regardless of age."* (`:84-89`) Hence: no window filter.
2. **Automatic responses** — *"A fan the system started and a gate it shut are plant state the
   incoming operator inherits, and nothing else in the carry-forward list would tell them."*
   (`:140-150`) These always require acknowledgement, because the entire point is that someone
   knowingly takes custody of them. Wrapped in `try/except` — a DB without the response tables must
   not stop a handover from being composed (`:148-149`, `:170-172`).
3. **Active facts** — `DISTINCT ON (asset_id, fact_type)` keeps only the newest value per pair, *so
   a fact that fired and then cleared during the shift does not carry* (`:214-215`). Whether it
   requires acknowledgement is decided by `risk/policy.dimensions_for()`, i.e. **the risk policy
   decides what is dangerous, not this module** (`:216-217`).
4. **Open tasks** — *"`unblock` tasks come from a `blocked` decision — the plant is stopped until
   they are done"* (`:275-278`), so those always require acknowledgement.
5. **Decision conditions** — *"A conditional approval is only as good as the condition surviving to
   the people doing the work. Conditions that die at shift change are the classic handover failure
   mode."* (`:326-330`) Always required.

### Ordering

`items.sort(key=_rank)` (`composer.py:41-47, 75`) then a stable `position` index. Sort key:

1. **Risk** — `blocking(0) → elevated(1) → nominal(2)` (`:26`)
2. **Type**, as tiebreak within a risk level (`:29-39`):
   `open_review(0) → response_action(1) → decision_condition(2) → active_fact(3) → open_task(4) → note(5)`
3. **Title**, alphabetical, for determinism.

Note this is **presentation ordering only** — the comment at `composer.py:25` is explicit that the
verdict itself is `risk/policy.classify`. Response actions rank just under reviews because *"it is
live equipment state, not a note"* (`:31-33`).

### Seeded-mode filter

Every one of the five queries takes a `:seeded_mode` parameter (`composer.py:56-64`), read from
`get_seeded_mode()` — the same flag `GET/POST /demo/seeded-mode` drives for Reviews and Reports.
Off → real rows only. On → real + mock together.

`derived_facts` has no `is_seeded` column of its own, so mock facts are identified the way
`scripts/quick_mock_seed.py`'s own cleanup does: by `provider = 'quick_mock'` on the
`context_entries` that produced them (`composer.py:219-221`, SQL at `:230-233`).

### `attention_asset_id`

The API also returns one asset id: the **worst thing you have not yet read** — the highest-risk
pending required item with an asset — falling back to the worst item overall once everything is
cleared (`service.py:109-117`). The twin's ShiftGate uses it to drop you on the right asset the
moment you accept (`ShiftGate.tsx:63-67`).

---

## 7. Hazard dimension chips

The small chips on an item card are the same four hazard dimensions the risk engine reasons in
(`risk/policy.py:55-64`):

| Dimension | Meaning |
| --- | --- |
| `atmosphere` | Hazardous substance present / containment lost |
| `ignition_energy` | Energy capable of initiating or escalating |
| `exposure` | People in the affected space |
| `control_failure` | Barriers missing, unverified, or in conflict |

They are derived from the fact type via `dimensions_for()` (`policy.py:143-148`) over the
`FACT_DIMENSIONS` map (`policy.py:88-108`) — e.g. `elevated_gas → atmosphere`,
`incomplete_isolation → {ignition_energy, control_failure}`, `zone_occupied → exposure`.

This is why the chips matter: `classify()` blocks on a **pathway** (atmosphere + ignition + control
failure), not a fact count. Chips let the incoming operator see which legs of a pathway they are
inheriting. Only `active_fact` items carry them — every other composer path emits `[]`.

---

## 8. The second surface — ShiftGate on the twin

The same ledger appears as a modal over `/operator` (`frontend/components/twin/ShiftGate.tsx`),
mounted from `TopNav.tsx:142-145`.

**When it opens:** only when a handover is genuinely waiting on *you* — `state === "issued"` and
`viewer_role === "incoming"` (`ShiftGate.tsx:58-59`), and only if you have not already dismissed
this handover id (`TopNav.tsx:41`, `:55-58`). Dismissal is per-handover, so it does not re-open on
every navigation.

**What it shows:** the brief, then `HandoverLedger` in `compact` mode with `canAcknowledge` on and
`canEdit` off — you can acknowledge and query, but not edit someone else's list.

**Two ways out:**
- **Accept shift** — disabled while `outstanding > 0`; on success routes you to
  `attention_asset_id` (`:63-67`).
- **Enter without accepting** — deliberately possible, and deliberately labelled as such. The
  component comment (`:21-27`) explains why: the previous version *"gated on nothing"*, and the fix
  was to make the bypass honest rather than dress it up as a skip. The bypass leaves the items
  pending — which is exactly what §9 then detects.

When no handover is waiting: *"No handover is waiting on you. You can enter the twin directly."*

---

## 9. The feedback loop — `unacknowledged_handover`

This is the part that makes handover an intelligence feature rather than a logbook.

```
items left pending on an issued handover
  → fetch_unacknowledged_for_asset(asset_id)           repository.py
  → assessment/pipeline.py loads them per review       pipeline.py:616-636
  → routing gate: run only if non-empty                routing.py:125-135
  → shift_handover agent emits the fact                nodes/shift_handover.py
  → risk/policy.classify() escalates nominal→elevated  policy.py:302-307
```

**Only `issued` handovers count** (`repository.py:fetch_unacknowledged_for_asset`): a draft has not
been handed to anyone, so nobody has failed to acknowledge it; an accepted one cleared its
requirements by construction.

**The agent** (`backend/app/agents/nodes/shift_handover.py`) picks the worst carried item and writes
a sentence naming it, who it was handed to, and how long ago —
*"'Vessel A — incomplete isolation' was handed to Arun 6.2 hours ago and has never been
acknowledged."* Its docstring calls this *"the Piper Alpha failure mode stated as a fact."*

It runs **pre-verdict**, unlike the other enrichment agents, because it changes the answer rather
than just the narration (`routing.py:125-135`, `graph.py:73-74`). The gate reads preloaded DB rows
rather than facts, because *"the question — did the incoming operator ever read this hazard — has
no answer in the telemetry"* (`routing.py:127-134`). Graph nodes stay pure, so the rows are loaded
in `pipeline.py`, not in the node.

**How the policy treats it** — carefully. `unacknowledged_handover` is a **non-grounding signal**
(`policy.py:118-131`), alongside `predicted_trend_risk` and `spatial_cooccurrence`:

- It **can** escalate a nominal asset to `elevated`, with the named rule
  `unacknowledged_handover` (`policy.py:302-307`) — deliberately named *before* the generic
  `agent_escalation` clause, so the reason reads specifically rather than as "an agent escalated".
- It **can** annotate a grounded verdict: *"This hazard also crossed a shift boundary
  unacknowledged."* appended last, so the ungrounded-block downgrade cannot discard it
  (`policy.py:329-331`).
- It **cannot** manufacture a hazard dimension or ground a block on its own. The reason
  (`policy.py:123-131`): *"it is a fact about paperwork, not about the plant"* — a missed
  acknowledgement must never complete an initiation pathway no sensor supports.

The recommendation it produces: *"Walk this hazard through with the outgoing operator and
acknowledge the handover item before authorizing work."* (`risk/recommendations.py:81-83`).

---

## 10. Metrics, gaps, and `/eval`

Two read-only endpoints exist beyond `/current`.

**`GET /handover/metrics`** (`repository.py:fetch_metrics`, one CTE query):

| Field | Definition |
| --- | --- |
| `handovers_total` | Handovers that were actually issued (`issued_at IS NOT NULL`) |
| `handovers_accepted` | …of which reached `accepted` |
| `required_items_total` / `_cleared` | Required items across issued handovers, and how many left `pending` |
| `coverage_pct` | `100 × cleared / total`, or 100.0 when nothing was required (`service.py:183`) |
| `median_ack_minutes` | `percentile_cont(0.5)` over `acknowledged_at − issued_at` |
| `unacknowledged_crossings` | Required items still pending on handovers that are `issued` or `expired` — **hazards that crossed a boundary unread** |

These render on `/eval` as the **Shift handover coverage** panel
(`frontend/components/eval/HandoverCoverage.tsx`, mounted at `frontend/app/eval/page.tsx:12`): three
stats — acknowledged %, median time to acknowledge, hazards crossed unacknowledged — plus a
footnote tying the last one back to `unacknowledged_handover`.

⚠️ **These numbers sit *beside* the compound-vs-single-sensor scorecard, never inside it.** Both the
Python docstring (`repository.py:fetch_metrics`) and the React comment
(`HandoverCoverage.tsx:8-16`) say so, and the panel's own subtitle tells the reader:
*"Operational — not a detector input."* Making a missed acknowledgement a scored detector input
would need a ground-truth criterion in `eval/hazard_ground_truth.py` first, or the confusion
matrices become circular — the same constraint CLAUDE.md places on spatial evidence.

**`GET /handover/gaps`** (`repository.py:fetch_gaps`) returns each unacknowledged required item on
an `issued` or `expired` handover, with `hours_outstanding`. It has a typed frontend client
(`liveApi.ts:726-728`) but **no UI consumer yet** — currently an API-only surface.

---

## 11. API reference

All under `/handover` (`routes.py:21`), no `/api` prefix.

| Method | Path | Guard | Returns |
| --- | --- | --- | --- |
| `GET` | `/handover/current` | none — anonymous reads as `observer` | active handover, else the most recent settled one, else `null` |
| `GET` | `/handover/gaps` | none | unacknowledged items that crossed a boundary |
| `GET` | `/handover/metrics` | none | process metrics (§10) |
| `POST` | `/handover/draft` | signed in; incoming ≠ you | composes + drafts, `201` |
| `POST` | `/handover/{id}/notes` | `draft` + outgoing | adds a manual note, `201` |
| `DELETE` | `/handover/{id}/items/{item_id}` | `draft` + outgoing | prunes an item |
| `POST` | `/handover/{id}/issue` | `draft` + outgoing | → `issued`; audits, notifies, broadcasts |
| `POST` | `/handover/{id}/items/{item_id}/ack` | `issued` + incoming | `acknowledged` or `queried` (+ note) |
| `POST` | `/handover/{id}/items/ack-all` | `issued` + incoming | clears every pending required item in one statement |
| `POST` | `/handover/{id}/accept` | `issued` + incoming + **0 outstanding** | → `accepted` |

Every write returns the **full reassembled `HandoverOut`**, so the client never has to re-fetch —
`run()` in the view just swaps the store value (`HandoverView.tsx:50-65`).

**Error semantics** (`routes.py:156-163`): `LookupError → 404` (unknown id),
`HandoverError → 409` (action illegal in the current state). The two guards behind those are
`_require_state` and `_require_party` (`service.py:519-535`), and their messages are written to be
shown verbatim — e.g. *"Only Meera can do this — you are signed in as Arun."*

Contract lists are frozen in `shared/api_contracts.ts:40-49`, mirrored to `frontend/shared/` by
`scripts/sync-shared.mjs`.

---

## 12. Data model

**`handovers`** (`schema.sql:396-416`) — actors are **polymorphic** (`users` | `workers`, see
`auth/schemas.ActorMeOut`), so `outgoing_actor_id` / `incoming_actor_id` **cannot be foreign keys**.
The names are snapshotted alongside the ids for the same reason evidence snapshots context: *a later
roster edit must not rewrite who was accountable at the moment custody changed hands*
(`schema.sql:398-401`). Resolution is users-first-then-workers (`service.py:48-66`).

**`handover_items`** (`schema.sql:418-443`) — each item **snapshots its own title/detail**, so
`review_id` / `asset_id` / `task_id` are links, not the record. All three are
`ON DELETE SET NULL`, which keeps the handover intact if a referenced row disappears
(`schema.sql:424-427` — matters mainly for test cleanup, which deletes reviews wholesale).

Indexes: `idx_handover_items_handover`, `idx_handover_items_asset`, `idx_handovers_state`, plus the
partial-unique `uq_handovers_active` (`schema.sql:445-459`).

---

## 13. Realtime, notifications, audit

**WebSocket events** — frozen in `shared/api_contracts.ts:75-77`:

| Event | Emitted by | Payload highlights |
| --- | --- | --- |
| `handover.issued` | `service.py:322-331` | outgoing/incoming names, `required_total` |
| `handover.item_acknowledged` | `service.py:377-387` (and `:430-440` for bulk) | item id(s), `ack_state`, `required_total`/`_cleared` |
| `handover.accepted` | `service.py:498-505` | incoming name, outgoing actor id |

The client handles all three with a single prefix match — any `handover.*` refetches
`/handover/current`, and `handover.issued` additionally refreshes notifications
(`liveStore.ts:1315-1320`). One refetch is the single source of truth for the panel's contents.

**Notifications** — `handover.issued` notifies the incoming operator (*"Meera handed over 3 items
needing your acknowledgement."*, `service.py:308-317`); `handover.accepted` notifies the outgoing
one (`service.py:487-493`). Both route to `/handover` when clicked
(`lib/notificationPresentation.ts:189-190`).

**Audit** — three hash-chained entries, written through `audit/service.record_audit` like everything
else (`schema.sql:395`): `handover.issued` (item + required counts, narration mode),
`handover.item_acknowledged` (item title, ack state, risk, note — or a `bulk: true` batch), and
`handover.accepted` (acknowledged count **and queried count**). Custody transfer is therefore
verifiable through `GET /audit/verify` alongside decisions.

---

## 14. Exercising it end to end

`GET /handover/current` is `null` on a fresh database — nothing seeds a handover at boot. Two ways
to get one:

**Manually, the demo path** (needs two browser profiles or a cookie swap, since the two sides are
different actors):

1. Sign in as **Meera** → `/handover` → pick **Arun**, look back 12h → **Compose handover**.
2. Review the draft. Prune anything irrelevant ("Not relevant"), add a note for what the system
   cannot see. → **Issue to Arun**.
3. Sign in as **Arun** → the ShiftGate modal opens over `/operator`, or go to `/handover` directly.
   **Acknowledge** each item (or **Query** one to leave a question on record).
4. **Accept shift** — enabled only once Outstanding hits 0.
5. Check `/eval` → coverage panel, and `GET /audit/verify` → chain intact.

To demo the *failure* path instead, stop after step 3 and press **Enter without accepting**. The
pending items then surface as `unacknowledged_handover` on the next assessment for that asset.

**In bulk** — `scripts/seed_history.py` drives the real service functions
(`open_draft → issue → partially acknowledge → maybe accept`, `:560-598`) once every
`--handover-every-days` simulated days (default 3, `0` disables), producing a history with both
cleared and uncleared crossings so the metrics panel has something to show.

---

## 15. Test coverage

| File | Covers |
| --- | --- |
| `backend/tests/test_handover.py:118` | Full cycle + **the accept gate refuses while items are pending** |
| `backend/tests/test_handover.py:167` | Narration reports `deterministic` under the mock provider |
| `backend/tests/test_handover.py:183` | An unacknowledged item **elevates a fresh review** |
| `backend/tests/test_response_handover.py:53,106` | An active response action carries; a revoked one does not |
| `backend/tests/test_incident_handover_agents.py:120-152` | Agent output for carried / clear / worst-first, and graph inclusion |

`test_handover.py` and `test_response_handover.py` are **DB-backed** — run them one file at a time,
and check with `-rs` that they did not silently skip on an unreachable Postgres (CLAUDE.md
*Tests*). `test_incident_handover_agents.py` is pure-logic and fast.

---

## 16. Things worth knowing before someone asks

**"Look back (hours)" is not the shift length.** It is the scan window for *facts* and *decision
conditions* only. Open reviews, open tasks and active response actions carry regardless of age
(§6). It is also not an expiry — nothing about a handover times out on its own.

**Acknowledging is not resolving.** Acknowledgement records that the incoming operator *read* the
hazard. The review stays open, the task stays open, the response action stays in effect. It closes
an information gap, not a hazard.

**A query still clears the gate.** `queried` counts as cleared (`service.py:135`) — it is an
on-record challenge, not a veto. The count is preserved in the accept audit payload.

**Only one handover exists at a time, globally** — not per asset, not per department
(`uq_handovers_active`). Composing a new one expires whatever was in flight, and the expired row's
unacknowledged items stay counted as gaps.

**The LLM cannot drop a hazard.** Composition is deterministic SQL; the model only writes the
paragraph. Under the default `AI_PROVIDER=mock` no model is contacted at all, and the chip says so.

**Handover coverage is not an accuracy metric.** It measures the humans, not the detectors, and is
deliberately excluded from `eval/detectors.py` to keep the compound-vs-single-sensor confusion
matrices non-circular (§10).

**The supervisor is never a party.** They read handovers as `observer` and decide elsewhere
(`seed.py:19-21`).

**Custody transfer is auditable like a decision.** Three hash-chained entry types, verifiable via
`GET /audit/verify` (§13). That is the claim behind the tour line *"Every transfer lands in the
audit chain."* (`tourScript.ts:611-612`).

---

## 17. One-paragraph version

`/handover` turns a shift change into an accountable custody transfer. A named outgoing operator
composes a carry-forward list — assembled by deterministic SQL from open reviews, active derived
facts, outstanding tasks, live approval conditions and automatic responses still in effect, plus
free-text notes for what the system cannot see — and issues it to a named incoming operator. The
incoming operator must acknowledge or query every high-risk item; `accept()` refuses until the
Outstanding count is zero. An LLM narrates the list but never chooses it, and the UI states which
of the three narration modes produced the prose. Every step is hash-chained into the audit log.
Items that cross a boundary unread are not merely logged: they re-enter the risk engine as
`unacknowledged_handover`, a non-grounding control-failure signal that escalates a nominal asset to
elevated and annotates any grounded verdict — the Piper Alpha failure mode, detected automatically.
