# Tour Defect Log

Observations recorded during a manual walk-through of the guided product tour.
Format per C·3: what I clicked → what I expected → what happened → reproduces?

> Issues marked **potential** have reproduction not yet confirmed.
> Issues marked **confirmed** reproduce on every attempt.
> Observations with no flag are working as expected.

---

| # | what I clicked | what I expected | what happened | reproduces? |
|---|---|---|---|---|
| 1 | All buttons on the first/landing page (product description, how it works, navigation) | Each button navigates to its stated destination | All buttons worked and navigated as labelled | y |
| 2 | "Launch Demo" → login page → clicked each role (Control Room Operator, Area Supervisor) | Show profiles of people in that role; allow login by selecting a profile | Role selection showed correct profiles; login through profile selection worked | y |
| 3 | Logged in as Arun → "Open Work" button on left sidebar (red badge showing 1) | Show open work items | Showed 1 notification in "closed"; clicking it showed the work (Vessel A) and pointed to Vessel A on the SVG floor plan | y |
| 4 | Clicked "Expand" button on Overview panel | Overview panel expands | Overview expanded as expected | y |
| 5 | Clicked Vessel A on the floor plan diagram | Review panel opens for Vessel A | Full review opened; can open message thread, post messages, make decisions; domain sections visible with access gated by role authority | y |
| 6 | Top bar → Settings → Reload button | Reload app data or page | Reload button only refreshes the settings buttons themselves (Apply, Reset Default, Reload); does not reload app data | potential defect — reproduction not yet confirmed |
| 7 | Top bar → Reports → clicked a report | Report detail opens; PDF and Excel download available; search works | All correct — report detail opened, PDF download worked, Excel download worked, search worked | y |
| 8 | Top bar → Eval → "Re-run" button | Re-run the evaluation | Button appeared to do nothing — no visible response | potential defect — reproduction not yet confirmed |
| 9 | Top bar → AI Ops → "Refresh" button | Refresh AI Ops data | Only refreshed the LangSmith box; rest of AI Ops did not refresh | potential defect — reproduction not yet confirmed |
| 10 | Top bar → AI Ops → "Open LangSmith" button | Open LangSmith in browser | Worked correctly | y |
| 11 | Top bar → Shift Handover → hours input field | Field label clearly communicates what the hours value means | Field label is ambiguous — unclear whether the value means "hand over for this many hours" or "I have worked this many hours" | confirmed UX defect — reproduces y |
| 12 | Shift Handover → saved as draft → confirmed → issued | Handover progresses through draft → confirm → issued states | Worked as expected | y |
| 13 | Logged out as Arun → logged in as Meera | Shift handover acknowledgement appears when there is an outstanding handover that must be accepted before proceeding | Shift handover acknowledgement screen appeared immediately on login — must acknowledge to accept shift before proceeding | y |
| 14 | Accepted handover → Shift Handover section | Items from outgoing operator appear; can query or acknowledge each | Items from Arun's handover appeared correctly; query and acknowledge actions both available and working | y |
| 15 | Acknowledged / queried all carry-forward items | "End shift" and "compose handover" options only appear after all items are cleared | Confirmed — "end shift" and "compose handover" options only appeared after all carry-forward items were acknowledged or queried | y |
| 16 | Logged in as Area Supervisor | Landing page loads with current zone state | "All clear in this zone" flashed briefly on screen before the Open / Acknowledged / Done sections appeared with actual data | confirmed UX defect — reproduces y |
| 17 | Area Supervisor → "Report Floor Issue" → selected people to tag → described issue → sent to operator | Tagging works; send button gated on description being entered; sends to operator | Tagging worked correctly; send button only enabled after description entered; sent to operator as expected | y |
| 18 | Notification button → opened panel → Alerts / Mentions & Updates tabs → Mentions & Updates tab | Notification button should show a badge, count, or highlight when there are unread mentions | Mentions were present under Mentions & Updates but the notification button showed no badge, count, or visual indicator of unread notifications | confirmed UX defect — reproduces y |

---

## Defect summary

| severity | # | description |
|---|---|---|
| confirmed | 11 | Shift Handover hours input — label is ambiguous; unclear if value means shift duration worked or handover duration |
| confirmed | 16 | Area Supervisor landing page — "All clear in this zone" flashes incorrectly before actual data loads |
| confirmed | 18 | Notification button — no badge, count, or visual indicator shown when unread mentions exist |
| potential | 6 | Settings → Reload — appears to only re-render settings buttons rather than reload app data; not yet confirmed |
| potential | 8 | Eval → Re-run — no visible response on click; not yet confirmed |
| potential | 9 | AI Ops → Refresh — only the LangSmith box refreshed; rest of page unaffected; not yet confirmed |

---

*Recorded during manual tour walk-through. Observer did not fix any defect — enumeration only.*
*Source of truth for W12 (Tour + legibility fixes).*
