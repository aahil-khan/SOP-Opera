# Compound vs Single-Sensor Evaluation

Headline metric: **false-negative rate** on cases where a statutory
stop-work provision applies.

## How cases are labeled

Ground truth comes from `app/eval/hazard_ground_truth.py`, which reads raw
context payloads against stop-work criteria drawn from the applicable
provisions (Factories Act 1948 s.37(1), s.41H and s.36(2), and the
OISD-STD-105 work permit system). Each carries a clause reference and a
primary-source URL.
It does **not** import or call the risk policy it scores — enforced by
`tests/test_eval_independence.py`.

This replaces the previous labeling function, which defined a case as
dangerous exactly when the compound engine fired, making a 0% false-negative
rate true by construction.

**Dataset:** 593 cases — 393 requiring stop-work (66%), 200 safe (34%). Cases come from a parameter sweep over
atmosphere level and trajectory, permit/isolation state, concurrent
operations, personnel presence and process temperature, plus scripted
scenario timelines.

## Summary

| Detector | Accuracy | Recall | FN rate | Precision |
| --- | ---: | ---: | ---: | ---: |
| Single-sensor baseline | 70.5% | 55.5% | 44.5% | 100.0% |
| Predictive forecast (ML trend) | 66.3% | 68.2% | 31.8% | 78.1% |
| Compound engine | 98.0% | 100.0% | 0.0% | 97.0% |

**FN reduction (compound vs single-sensor):** 100.0%

### What this measures, and what it does not

This is a **criterion-coverage** measurement: of the plant states where a
regulation requires stopping work, how many does each detector catch? The
compound engine implements those provisions, so high recall is expected —
the meaningful comparison is against the single-sensor baseline scored on
the *same* labels, which is how a conventional SCADA threshold alarm
performs: it misses 175 of 393 stop-work cases.

It is **not** a claim about generalizing to unseen real-world incidents.
The 12 compound false positives are cases where the engine
is deliberately more conservative than the statutory minimum (for example,
hot work with unverified isolation and personnel present, at a clean gas
reading). For a stop-work system that is a defensible bias, not a defect.

## Prediction lead time (hero scenario)

Measured in **plant process time** from each scenario step's
`t_offset_minutes` — not the simulator's playback pacing.

VSP coke-oven timeline: forecast alarm at **t+6 min**, compound alarm at **t+6 min**, single-sensor critical at **t+34 min** → **28 minutes of lead time** before the incident threshold.

## Regulatory coverage

Of the cases where the rules engine derives at least one fact, how many
have a regulation the deterministic retriever can cite for that fact?

- Cases with derived facts: **576**
- With a citable regulation: **100.0%**
- With an Indian statutory provision: **91.7%**

| Standard | Citations available |
| --- | ---: |
| Factories Act 1948 | 791 |
| OISD | 106 |

## Hero checkpoint

Case `vsp_coke_oven_step2` — compound blocks while gas stays below the
single-sensor critical threshold.

## Per-case detail

Scenario and named cases; the parameter sweep is omitted for length.

| Case | Stop-work required | Single | Compound | Compound-only catch |
| --- | --- | --- | --- | --- |
| nominal_safe | False | False | False | False |
| elevated_gas_only | False | False | False | False |
| critical_gas_only | True | True | True | False |
| vsp_pattern_subcritical | True | False | True | True |
| permit_conflict_only | False | False | False | False |
| vsp_coke_oven_step0 | False | False | False | False |
| vsp_coke_oven_step1 | True | False | True | True |
| vsp_coke_oven_step2 | True | False | True | True |
| vsp_coke_oven_step3 | True | False | True | True |
| vsp_coke_oven_step4 | True | True | True | False |
| compound_risk_step0 | False | False | False | False |
| compound_risk_step1 | True | False | True | True |
| compound_risk_step2 | True | False | True | True |
| compound_risk_step3 | True | False | True | True |
| gas_leak_step0 | False | False | False | False |
| permit_conflict_step0 | False | False | False | False |
| permit_conflict_step1 | False | False | False | False |
