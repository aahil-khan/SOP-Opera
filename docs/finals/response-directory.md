# Emergency Response Directory

> **DEMO-ONLY — fictional contacts.** This directory is a Track C documentation deliverable for the SOP Opera demo.
> Contact numbers are not real. The escalation chain described here is not implemented in the application.
> Roles marked **[app]** exist as seeded roles in `backend/app/db/seed.py`. Roles marked **[demo]** are
> documentary additions for the emergency-response path and have no corresponding application role.

---

| role | zone | contact | escalation_order |
|---|---|---|---|
| Area Supervisor — Coke Oven Battery **[app]** | `coke-oven-battery` | +91-DEMO-1001 | 1 — first on-site contact; stop hot work, account for personnel |
| Area Supervisor — Hazardous Zone **[app]** | `hazardous` | +91-DEMO-1002 | 1 — first on-site contact; stop work, account for personnel |
| Area Supervisor — Tank Farm **[app]** | `tank-farm` | +91-DEMO-1003 | 1 — first on-site contact; stop transfers, confirm isolation |
| Area Supervisor — Compressor Yard **[app]** | `compressor-yard` | +91-DEMO-1004 | 1 — first on-site contact; isolate equipment |
| Area Supervisor — Gas Cleaning **[app]** | `gas-cleaning` | +91-DEMO-1005 | 1 — first on-site contact; isolate gas stream |
| Shift Lead **[app]** | `central-control` / `control-room` | +91-DEMO-2001 | 2 — plant-wide coordination; contacted after area supervisor confirms |
| Shift Supervisor (decision_maker) **[app]** | `admin-office` | +91-DEMO-3001 | 3 — decision authority; authorises Tier 2 actions and permit freeze |
| Fire & Rescue — plant team **[demo]** | `fire-water` (Fire Water Pump Station, first floor) | +91-DEMO-9001 | 4 — called by Shift Supervisor only; not an application role |
| Medical / First Aid **[demo]** | `muster-point` (Muster Point, second floor) | +91-DEMO-9002 | 4 — concurrent with Fire & Rescue when personnel exposure confirmed; not an application role |

---

## Notes

### Role source
Application roles (`Area Supervisor`, `Shift Lead`, `Shift Supervisor` / `decision_maker`, `panel_operator`)
are seeded in `backend/app/db/seed.py` — `ZONE_OWNERS` (lines 116–143) and `OPERATORS` / `OWNER_ID`
(lines 23–26, 191).

### Zone labels
Zone strings are verbatim from `ASSETS` and `ZONE_OWNERS` in `backend/app/db/seed.py`.
`fire-water` and `muster-point` are seeded assets on first and second floor respectively.

### What is not in the application
- No response-team roles, emergency contacts, or escalation chain exist in the application code.
- `Fire & Rescue` and `Medical / First Aid` appear here to make the Tier 1 "page the response team"
  action (W1) concrete for the demo. They are explicitly labelled `[demo]`.

### Escalation order logic
| order | meaning |
|---|---|
| 1 | On-site Area Supervisor for the affected zone — always first |
| 2 | Shift Lead in Central Control Room — plant-wide coordination |
| 3 | Shift Supervisor — required before any Tier 2 action executes |
| 4 | External teams — Fire & Rescue and Medical run concurrently at this level |

*Source: `backend/app/db/seed.py` (roles, zones, assets)*
