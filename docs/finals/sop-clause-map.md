# SOP Clause Map

Maps each of the 16 derived facts in `backend/app/context/derived_facts.py` to the SOP that governs it.
Source of truth for SOPs: the `SOPS` list in `backend/app/db/seed_embeddings.py` (13 entries).

16 facts against 13 SOPs → **3 gaps by arithmetic**. Gaps are marked `—` and not guessed.
These gaps are findings for W2 — do not fill them with invented clauses.

| fact_type | sop_id | sop_title | clause | what the clause requires |
| --- | --- | --- | --- | --- |
| `elevated_gas` | `b2222222-2222-2222-2222-222222222212` | SOP-OISD Coke Oven Gas Response | Factories Act 1948 s.37(1)(c); OISD-STD-105 | Stop hot work, confirm isolation tags, evacuate non-essential personnel, and do not re-enter until atmosphere is verified below action level. |
| `critical_gas` | — | — | — | **GAP** — no SOP seeded for `critical_gas`. Closest covers `elevated_gas` (b...12); critical threshold level is not separately governed. Flag for W2. |
| `permit_conflict` | `b2222222-2222-2222-2222-222222222201` | SOP-PTW-Conflict Resolution | — | When two active permits overlap on an asset, stop work, notify the area authority, and cancel the lower-priority permit. |
| `zone_occupied` | `b2222222-2222-2222-2222-222222222213` | SOP-Factory Act Zone Clearance | — | When gas alarms are active or isolation is unverified, clear all personnel from the hazardous zone and account for workers before authorising any permit restart. |
| `incomplete_isolation` | `b2222222-2222-2222-2222-222222222202` | SOP-Isolation Verification | — | Walk the isolation boundary, apply tags, and obtain a second verifier signature before issuing a hot work permit. |
| `simultaneous_ops` | `b2222222-2222-2222-2222-222222222203` | SOP-SIMOPS Coordination | — | Simultaneous operations require a joint toolbox talk and a single SIMOPS coordinator before starting. |
| `certification_expiring` | `b2222222-2222-2222-2222-222222222204` | SOP-Certification Check | — | Shift supervisors verify worker cert expiry dates at the permit board before authorising entry. |
| `over_temperature` | `b2222222-2222-2222-2222-222222222205` | SOP-Temperature Excursion Response | — | On over-temperature alarm, reduce firing rate, notify control, and open a review before restarting production. |
| `critical_temperature` | — | — | — | **GAP** — no SOP seeded for `critical_temperature`. Closest covers `over_temperature` (b...05); critical threshold level is not separately governed. Flag for W2. |
| `equipment_vibration_anomaly` | `b2222222-2222-2222-2222-222222222206` | SOP-Rotating Equipment Vibration | — | Log ISO severity band, schedule balance check, and isolate if vibration persists above band C. |
| `effluent_quality_breach` | `b2222222-2222-2222-2222-222222222207` | SOP-Effluent Guard | — | Divert out-of-spec effluent to holding; do not discharge until lab confirms remediation. |
| `tank_level_critical` | `b2222222-2222-2222-2222-222222222208` | SOP-Tank Level Critical | — | On high-high or low-low tank level, stop transfers and verify instrumentation before resuming. |
| `ppe_noncompliance` | `b2222222-2222-2222-2222-222222222209` | SOP-PPE Gate | — | Refuse zone entry until PPE is compliant; record the noncompliance against the work party. |
| `lifting_operation_conflict` | `b2222222-2222-2222-2222-222222222210` | SOP-Lift Conflict Clearance | — | Suspend both lifts, clear the airspace, and restart under one lift plan only. |
| `weather_hold` | `b2222222-2222-2222-2222-222222222211` | SOP-Weather Hold | — | When weather hold triggers, pause hot work and outdoor lifts; resume only after all-clear from shift lead. |
| `supervisor_floor_report` | — | — | — | **GAP** — no SOP seeded for the `supervisor_report` category. The fact dispatches to typed concern types (e.g. `supervisor_safety_hazard`) via `reviews/concerns.py` but no governing SOP is seeded. Flag for W2. |

---

## Notes

### On clause numbers
The 13 seeded SOPs are single-paragraph procedural entries without numbered internal clauses.
Only `SOP-OISD Coke Oven Gas Response` (b...12) explicitly references external regulatory clauses:
Factories Act 1948 s.37(1)(c) and OISD-STD-105. All other clause cells are `—` because the data
does not support a number — not because the requirement does not exist.

### The 3 gaps — detail

| fact_type | gap reason |
| --- | --- |
| `critical_gas` | Corpus has one gas SOP mapped to `elevated_gas`. `critical_gas` aliases to `elevated_gas` in the deterministic retriever (`assessment/retrieval/deterministic.py:63`) but has no dedicated SOP. |
| `critical_temperature` | Same pattern — aliases to `over_temperature` in the retriever but no dedicated SOP. |
| `supervisor_floor_report` | No `SOPS` entry covers the `supervisor_report` context category. The rule dispatches to `SUPERVISOR_FACT_TYPES` via `reviews/concerns.py::fact_type_for_concern()`. |

### On `supervisor_floor_report` fact type
This rule does not write `supervisor_floor_report` as the stored fact type. It maps the incoming
`concern_type` to a typed fact (e.g. `supervisor_safety_hazard`) via `reviews/concerns.py`. The SOP gap
applies to all concern types in that category.

---

*Source: `backend/app/context/derived_facts.py` (rules), `backend/app/db/seed_embeddings.py:207-289` (SOPs)*
*See also §8.3 of the work plan: the `spatial_cooccurrence → zone_occupied` alias in the retriever is flagged*
*as the weakest alias and should be replaced when a dedicated clause is seeded by Track C.*
