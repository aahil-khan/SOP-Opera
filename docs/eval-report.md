# Compound vs Single-Sensor Evaluation

Headline metric for the VSP coke-oven story: **false-negative rate** on
ground-truth dangerous cases (blocking intervention warranted).

## Summary

| Detector | Accuracy | Recall | FN rate | Precision |
| --- | ---: | ---: | ---: | ---: |
| Single-sensor baseline | 76.5% | 33.3% | 66.7% | 100.0% |
| Compound engine | 94.1% | 100.0% | 0.0% | 85.7% |

**FN reduction (compound vs single-sensor):** 100.0%

## Prediction lead time (hero scenario)

VSP coke-oven timeline: compound alarm at **8s**, single-sensor critical at **26s** → **18s lead time** before incident threshold.

## Hero checkpoint

Case `vsp_coke_oven_step2` — compound blocks while gas stays below the
single-sensor critical threshold.

## Per-case detail

| Case | Dangerous | Single | Compound | Compound-only catch |
| --- | --- | --- | --- | --- |
| nominal_safe | False | False | False | False |
| elevated_gas_only | False | False | False | False |
| critical_gas_only | True | True | True | False |
| vsp_pattern_subcritical | True | False | True | True |
| permit_conflict_only | False | False | False | False |
| vsp_coke_oven_step0 | False | False | False | False |
| vsp_coke_oven_step1 | False | False | False | False |
| vsp_coke_oven_step2 | True | False | True | True |
| vsp_coke_oven_step3 | True | False | True | True |
| vsp_coke_oven_step4 | True | True | True | False |
| compound_risk_step0 | False | False | False | False |
| compound_risk_step1 | False | False | False | False |
| compound_risk_step2 | False | False | True | False |
| compound_risk_step3 | True | False | True | True |
| gas_leak_step0 | False | False | False | False |
| permit_conflict_step0 | False | False | False | False |
| permit_conflict_step1 | False | False | False | False |
