# Tour Defect Log

Observations recorded during manual testing of SOP Opera.
Format per C·3: what I clicked → what I expected → what happened → reproduces?

> Issues marked **potential** have reproduction not yet confirmed.
> Issues marked **confirmed** reproduce on every attempt.
> Observations with no flag are working as expected (PASS rows use — for reproduces?).

---

## Product Walkthrough

General product walk-through observations, logged prior to the guided tour pass.

| # | what I clicked | what I expected | what happened | reproduces? |
|---|---|---|---|---|
| 1 | All buttons on the first/landing page (product description, how it works, navigation) | Each button navigates to its stated destination | All buttons worked and navigated as labelled | — |
| 2 | "Launch Demo" → login page → clicked each role (Control Room Operator, Area Supervisor) | Show profiles of people in that role; allow login by selecting a profile | Role selection showed correct profiles; login through profile selection worked | — |
| 3 | Logged in as Arun → "Open Work" button on left sidebar (red badge showing 1) | Show open work items | Showed 1 notification in "closed"; clicking it showed the work (Vessel A) and pointed to Vessel A on the SVG floor plan | — |
| 4 | Clicked "Expand" button on Overview panel | Overview panel expands | Overview expanded as expected | — |
| 5 | Clicked Vessel A on the floor plan diagram | Review panel opens for Vessel A | Full review opened; can open message thread, post messages, make decisions; domain sections visible with access gated by role authority | — |
| 6 | Top bar → Settings → Reload button | Reload app data or page | Reload button only refreshes the settings buttons themselves (Apply, Reset Default, Reload); does not reload app data | potential defect — reproduction not yet confirmed |
| 7 | Top bar → Reports → clicked a report | Report detail opens; PDF and Excel download available; search works | All correct — report detail opened, PDF download worked, Excel download worked, search worked | — |
| 8 | Top bar → Eval → "Re-run" button | Re-run the evaluation | Button appeared to do nothing — no visible response | potential defect — reproduction not yet confirmed |
| 9 | Top bar → AI Ops → "Refresh" button | Refresh AI Ops data | Only refreshed the LangSmith box; rest of AI Ops did not refresh | potential defect — reproduction not yet confirmed |
| 10 | Top bar → AI Ops → "Open LangSmith" button | Open LangSmith in browser | Worked correctly | — |
| 11 | Top bar → Shift Handover → hours input field | Field label clearly communicates what the hours value means | Field label is ambiguous — unclear whether the value means "hand over for this many hours" or "I have worked this many hours" | confirmed UX defect — y |
| 12 | Shift Handover → saved as draft → confirmed → issued | Handover progresses through draft → confirm → issued states | Worked as expected | — |
| 13 | Logged out as Arun → logged in as Meera | Shift handover acknowledgement appears when there is an outstanding handover that must be accepted before proceeding | Shift handover acknowledgement screen appeared immediately on login — must acknowledge to accept shift before proceeding | — |
| 14 | Accepted handover → Shift Handover section | Items from outgoing operator appear; can query or acknowledge each | Items from Arun's handover appeared correctly; query and acknowledge actions both available and working | — |
| 15 | Acknowledged / queried all carry-forward items | "End shift" and "compose handover" options only appear after all items are cleared | Confirmed — "end shift" and "compose handover" options only appeared after all carry-forward items were acknowledged or queried | — |
| 16 | Logged in as Area Supervisor | Landing page loads with current zone state | "All clear in this zone" flashed briefly on screen before the Open / Acknowledged / Done sections appeared with actual data | confirmed UX defect — y |
| 17 | Area Supervisor → "Report Floor Issue" → selected people to tag → described issue → sent to operator | Tagging works; send button gated on description being entered; sends to operator | Tagging worked correctly; send button only enabled after description entered; sent to operator as expected | — |
| 18 | Notification button → opened panel → Alerts / Mentions & Updates tabs → Mentions & Updates tab | Notification button should show a badge, count, or highlight when there are unread mentions | Mentions were present under Mentions & Updates but the notification button showed no badge, count, or visual indicator of unread notifications | confirmed UX defect — y |

### Product Walkthrough — Defect summary

| severity | # | description |
|---|---|---|
| confirmed | 11 | Shift Handover hours input — label is ambiguous; unclear if value means shift duration worked or handover duration |
| confirmed | 16 | Area Supervisor landing page — "All clear in this zone" flashes incorrectly before actual data loads |
| confirmed | 18 | Notification button — no badge, count, or visual indicator shown when unread mentions exist |
| potential | 6 | Settings → Reload — appears to only re-render settings buttons rather than reload app data; not yet confirmed |
| potential | 8 | Eval → Re-run — no visible response on click; not yet confirmed |
| potential | 9 | AI Ops → Refresh — only the LangSmith box refreshed; rest of page unaffected; not yet confirmed |

---

## Guided Tour Pass

Manual 15-step walk-through of the in-app guided tour. Steps include both PASS observations (evidence the step was tested) and defect observations.

| tour step | what I clicked / interacted with | what the tour expected me to see/do | what actually happened | defect or PASS | reproduces? |
|---|---|---|---|---|---|
| 1 — Overture | Clicked the tour button; tour card appeared | Tour card shows overture with controls: switch to Auto, Start Over, Next, Skip Tour | Card appeared correctly; mode defaulted to Manual; Start Over disabled initially; Next and Skip Tour available | PASS | — |
| 2 — Digital Twin introduction | Clicked Next | Digital Twin view opens; card describes the Digital Twin | Digital Twin opened and card gave a description of the Digital Twin | PASS | — |
| 3 — Rising Tension | Clicked Next | Card titled "Rising Tension"; highlights floors with elevated risk on ground floor | Card appeared with correct title; ground floor highlighted with elevated risk | PASS | — |
| 4 — The Cast Deliberates | Clicked Next | Card titled "The Cast Deliberates"; instructs user to click the highlighted (affected) asset to open a full review | Card appeared with correct title and instruction to click the highlighted asset | PASS | — |
| 5 — The Cast Deliberates (continued) | Clicked the highlighted affected vessel | Highlight shifts to the live reasoning area; card description updates to explain AI agent involvement in live reasoning | Highlight shifted correctly; card updated description as expected | PASS | — |
| 5a — Highlight box alignment | Observed highlight border around live reasoning area | Highlight border should be snug around the highlighted content | Highlight border has excessive space at the top and barely touches / clips the text at the bottom — border is misaligned vertically | confirmed UX defect | y |
| 5b — The Cast Deliberates: inconsistent state on revisit | From the current step, navigated back via the tour dot/previous step, then clicked Next to return to the same step (Path B); compared against reaching the step directly (Path A) | The same tour step should produce the same UI state and highlighted content regardless of whether it was reached directly or via Back → Next | Path A: Live Reasoning panel showed one state and scroll position; Path B: the same step showed different content and scroll position in the Live Reasoning panel — the UI state was not consistent between the two navigation paths | confirmed defect | y |
| 6 — The Evidence (sub-step 1) | Clicked Next; card appeared after a short delay | Card titled "The Evidence"; description tells user to click the highlighted hexagon; highlighted area should correspond to the hexagon | Card title and description refer to a clickable hexagon, but the highlighted portion is the candidate actions and recommended actions area — description and highlighted element do not match | defect — mismatch between card description and highlighted element | y |
| 7 — The Evidence (sub-step 2) | Clicked Next | Card still titled "The Evidence"; description should describe the highlighted area | Card description updated to explain in plain language why the action was taken — description matched the highlighted area | PASS | — |
| 8 — The Evidence (sub-step 3) | Clicked Next; card appeared after a delay | Card still titled "The Evidence"; description about lead time | Card appeared after a delay with "The Evidence" title and described the lead time | PASS | — |
| 9 — The Verdict | Clicked Next | Card titled "The Verdict"; description highlights recommended actions provided by AI that require supervisor acceptance; highlight border should frame the relevant area | Card appeared with correct title and description; highlight border is misaligned — too high, should shift down | confirmed UX defect — highlight border vertical misalignment (recurring) | y |
| 10 — The Vault | Clicked Next | Card titled "The Vault"; description explains the audit trail; highlighted area should correspond to the audit trail | Card appeared with correct title and description of the audit trail; highlighted box is misaligned | confirmed UX defect — highlight border misalignment (recurring — steps 5a, 9, 10) | y |
| 11 — Changing of the Guard | Clicked Next | Card titled "Changing of the Guard"; description explains shift handover; highlighted box should frame content with appropriate padding; content should be scrollable if needed | Card appeared with correct title and description; highlighted box cuts off exactly where text ends — no bottom padding; content is not scrollable | confirmed UX defect — no bottom padding on highlight border; content not scrollable | y |
| 12 — The Scoreboard | Clicked Next | Card titled "The Scoreboard"; describes how single-sensor and compound risk metrics are calculated; highlighted box shows the metrics | Card appeared with correct title; description and highlighted metrics area are correct | PASS | — |
| 13 — The Scoreboard (continued) | Clicked Next | Card title should update for the new content; description and highlight should describe AI Ops | Card title remained "The Scoreboard" while the description and highlighted area changed to AI Ops content — card title did not update | potential defect — card title did not change when content and highlight changed to AI Ops | y |
| 14 — Curtain Call | Clicked Next | Final card appears titled "Curtain Call" with a short conclusion and end-of-tour controls: Finish, Start Over, Skip Tour, switch to Auto | Card appeared with title "Curtain Call", short conclusion, and all four controls present | PASS | — |
| 15 — Post-tour state | Clicked Finish | App should return to the default clean floor view | App remained in the expanded tour/Vessel A view — UI was not reset to the default state on finishing the tour | defect — tour Finish does not reset the UI to the default view | y |

### Guided Tour Pass — Defect summary

| severity | tour step | description |
|---|---|---|
| confirmed UX defect | 5a | Highlight border vertically misaligned — excessive space at top, clips/barely touches content at bottom |
| confirmed defect | 5b | The Cast Deliberates step produces different Live Reasoning panel state/content/scroll position depending on whether the step is reached directly or via Back → Next |
| defect | 6 | Tour card description references a clickable hexagon; the highlighted element is the candidate/recommended actions area — mismatch |
| confirmed UX defect | 9 | Highlight border vertically misaligned (same as step 5a — recurring across steps) |
| confirmed UX defect | 10 | Highlight border misaligned (recurring — steps 5a, 9, 10) |
| confirmed UX defect | 11 | Highlight box has no bottom padding; shift handover content is not scrollable |
| potential defect | 13 | Card title remained "The Scoreboard" when description and highlight changed to AI Ops content |
| defect | 15 | Clicking Finish leaves the application in the expanded tour/Vessel A view instead of resetting to the default clean floor view |

---

*Recorded during manual product walk-through and guided tour pass. Observer did not fix any defect — enumeration only.*
*Source of truth for W12 (Tour + legibility fixes).*
