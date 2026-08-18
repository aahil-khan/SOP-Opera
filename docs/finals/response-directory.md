# Emergency Response Directory

> **DEMO-ONLY — fictional contacts.** This directory is a Track C documentation deliverable for the SOP Opera demo.
> Contact numbers are not real. The escalation chain described here is not implemented in the application.
> Roles marked **[app]** exist as seeded roles in `backend/app/db/seed.py`. Roles marked **[demo]** are
> documentary additions for the emergency-response path and have no corresponding application role.

---

| role | zone | contact | escalation_order |
|---|---|---|---|
| Area Supervisor — Coke Oven Battery (Asha Rao) **[app]** | `coke-oven-battery` | +91-DEMO-1001 | 1 — first on-site contact; stop hot work, account for personnel |
| Area Supervisor — Hazardous Zone (Imran Khan) **[app]** | `hazardous` | +91-DEMO-1002 | 1 — first on-site contact; stop work, account for personnel |
| Area Supervisor — Tank Farm (Dev Patel) **[app]** | `tank-farm` | +91-DEMO-1003 | 1 — first on-site contact; stop transfers, confirm isolation |
| Area Supervisor — Compressor Yard (Priya Nair) **[app]** | `compressor-yard` | +91-DEMO-1004 | 1 — first on-site contact; isolate equipment |
| Area Supervisor — Gas Cleaning (Asha Rao) **[app]** | `gas-cleaning` | +91-DEMO-1001 | 1 — same seeded owner as Coke Oven Battery; first on-site contact |
| Shift Lead (Meera Joshi) **[app]** | `admin-office` | +91-DEMO-2001 | 2 — plant-wide coordination; contacted after area supervisor confirms |
| Shift Lead (Imran Khan) **[app]** | `central-control` / `control-room` | +91-DEMO-1002 | 2 — same seeded owner as Hazardous Zone; plant-wide coordination |
| Shift Supervisor / decision_maker (Rajesh) **[app]** | no zone assigned in seed | +91-DEMO-3001 | 3 — decision authority; authorises Tier 2 actions and permit freeze |
| Fire & Rescue — plant team **[demo]** | `fire-water` (Fire Water Pump Station, first floor — seeded owner: Asha Rao, +91-DEMO-1001) | +91-DEMO-9001 | 4 — called by Shift Supervisor only; not an application role |
| Medical / First Aid **[demo]** | `muster-point` (Muster Point, second floor) | +91-DEMO-9002 | 4 — concurrent with Fire & Rescue when personnel exposure confirmed; not an application role |

---

## Notes

### Scope
This directory covers 5 of the 24 zones seeded in `ZONE_OWNERS` (`backend/app/db/seed.py` lines 116–143).
The 5 zones selected are those on the direct emergency-response path; the remaining 19 zones are not included.

### Shared seeded owners
The seed assigns one worker per zone. Three of the five emergency-path zones share seeded owner **Asha Rao**
(`...5551`): `coke-oven-battery`, `gas-cleaning`, and `fire-water`. The directory reflects this with the same
contact (+91-DEMO-1001) for all three. This is a seed data characteristic, not a directory simplification.

Similarly, **Imran Khan** (`...5552`) is the seeded owner of both `hazardous` and `central-control` /
`control-room` (Shift Lead role for the latter two).

### Shift Supervisor zone
**Rajesh (Shift Supervisor)** is seeded as `decision_maker` in the `users` table but does not appear in
`ZONE_OWNERS`. No zone is assigned to this role in the seed. The escalation entry is included because the
role exists in the application; the zone cell reflects the seed accurately.

### Role source
Application roles (`Area Supervisor`, `Shift Lead`) are seeded in `ZONE_OWNERS` (lines 116–143).
`decision_maker` is seeded in the `users` table (lines 190–192). `Fire & Rescue` and `Medical / First Aid`
are `[demo]` roles with no application counterpart.

*Source: `backend/app/db/seed.py`*
