# LLM-as-detector baseline

Generated 2026-08-14T19:35:08+00:00.

**The question this answers: "why not just ask GPT-4 whether it's safe?"** So we did — same plant states, same statutory labels, scored
the same way.

**n = 150** stratified cases sampled from the full 593-case
dataset (seed 20260825, proportional across label × case family).
The deterministic detectors below are scored on the **full** dataset;
the LLM is not, and that difference is stated rather than smoothed over.

## Results

| Detector | n | Recall | Precision | FN | Accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| LLM (ollama:llama3.2) run 1 | 150 | 96.0% | 67.4% | 4 | 66.7% |
| LLM (ollama:llama3.2) run 2 | 150 | 97.0% | 66.7% | 3 | 66.0% |
| Single-sensor baseline (full set) | 593 | 55.5% | 100.0% | 175 | 70.5% |
| **Compound engine (full set)** | 593 | **100.0%** | 97.0% | **0** | 98.0% |

## Run-to-run agreement

Across 2 runs on identical inputs, the model changed its own answer on **7.3%** of cases.
The rules engine's equivalent number is 0% by construction — it
is a pure function. For a stop-work decision that has to be
defensible after an incident, reproducibility is not a nicety.

## Cost of the comparison

- Latency per judgement: p50 883.76 ms · p95 1176.23 ms
- Unparseable answers (scored as PROCEED): 0

## What is not here

- **OpenAI baseline: NOT RUN — no API key available.** The harness takes `--provider openai_compatible`; it needs only the key to produce the hosted row. No hosted numbers are estimated in its place.
- The LLM detector is **eval-only**. It is not imported by the
  assessment pipeline and cannot affect a shipped verdict.
