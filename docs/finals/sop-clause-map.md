# SOP Clause Map

Maps each of the 16 derived facts in `backend/app/context/derived_facts.py` to the SOP that governs it.
Source of truth for SOPs: the `SOPS` list in `backend/app/db/seed_embeddings.py` (13 entries).

The verification identified uncovered categories in the current seeded SOP corpus. These gaps are explicitly marked rather than assigning invented SOP clauses.
These gaps are findings for W2 — do not fill them with invented clauses.

| fact_type | sop_id | sop_title | clause | what the clause requires |
|---|---|---|---|---|
| `elevated_gas` | `b2222222-2222-2222-2222-222222222212` | SOP-OISD Coke Oven Gas Response | `Factories Act 1948 s.37(1)(c); OISD-STD-105` | Stop hot work, confirm isolation tags, evacuate non-essential personnel, and do not re-enter until atmosphere is verified below action level. |
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
| `supervisor_floor_report` | — | — | — | **GAP** — The `supervisor_floor_report` rule can produce six supervisor-related fact types depending on `concern_type`: `supervisor_safety_hazard`, `supervisor_equipment_issue`, `supervisor_permit_issue`, `supervisor_environmental_issue`, `supervisor_personnel_issue`, or `supervisor_floor_report`. None of these categories has a matching seeded SOP. Flag for W2. |

---

## Notes

### How the mapping was verified

The mapping is not hand-derived. Each entry in the `SOPS` list carries the governed
`fact_type` as its **fourth tuple element** (`backend/app/db/seed_embeddings.py:213, 219, 225`, …),
so every row below is checked against the seed's own field rather than inferred from the SOP title.
A row is a gap precisely when no `SOPS` entry declares that `fact_type`.

### On clause numbers

The 13 seeded SOPs are single-paragraph procedural entries without numbered internal clauses.
Only `SOP-OISD Coke Oven Gas Response` (b...12) explicitly references external regulatory clauses:
Factories Act 1948 s.37(1)(c) and OISD-STD-105. All other clause cells are `—` because the data
does not support a number — not because the requirement does not exist.

### On the gaps

| fact_type | gap reason |
|---|---|
| `critical_gas` | Corpus has one gas SOP mapped to `elevated_gas`. `critical_gas` aliases to `elevated_gas` in the deterministic retriever (`assessment/retrieval/deterministic.py`) but has no dedicated SOP. |
| `critical_temperature` | Same pattern — aliases to `over_temperature` in the retriever but no dedicated SOP. |
| `supervisor_floor_report` | No `SOPS` entry covers any of the six supervisor fact types produced by `rule_supervisor_floor_report` via `reviews/concerns.py::fact_type_for_concern()`. |

### Coverage caveat: `zone_occupied`

The mapping `zone_occupied → SOP-Factory Act Zone Clearance` is verified correct against the seeded corpus.
However, the `zone_occupied` derived-fact rule fires for any hazardous-zone occupancy report
(`worker_location.payload["zone"] == "hazardous"`), while the seeded SOP specifically describes clearing
personnel when gas alarms are active or isolation is unverified. The SOP condition is therefore narrower
than the rule condition and does not necessarily cover every scenario that can generate `zone_occupied`.
Flag this mismatch for W2 rather than changing the verified mapping.

### On `supervisor_floor_report` fact type

`rule_supervisor_floor_report` does not write `supervisor_floor_report` as the stored fact type in all
cases. It calls `fact_type_for_concern(concern_type)` from `reviews/concerns.py`, which maps:

- `safety_hazard` → `supervisor_safety_hazard`
- `equipment` → `supervisor_equipment_issue`
- `permit_isolation` → `supervisor_permit_issue`
- `environmental` → `supervisor_environmental_issue`
- `personnel` → `supervisor_personnel_issue`
- `other` (or unrecognised) → `supervisor_floor_report`

None of these six output fact types has a seeded SOP. The gap applies to all six.

---

*Source: `backend/app/context/derived_facts.py` (rules), `backend/app/db/seed_embeddings.py:208-291` (SOPs), `backend/app/reviews/concerns.py` (supervisor concern mapping)*
