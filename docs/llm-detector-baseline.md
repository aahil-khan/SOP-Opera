# LLM-as-detector baseline

Generated 2026-08-15T16:54:17+00:00.

**The question this answers: "why not just ask GPT-4 whether it's safe?"** So we did — same plant states, same statutory labels, scored
the same way.

**n = 150** stratified cases sampled from the full 593-case
dataset (seed 20260825, proportional across label × case family).
The deterministic detectors below are scored on the **full** dataset;
the LLM is not, and that difference is stated rather than smoothed over.

## Results

**Read the alarm-rate column before the recall column.** A detector that shouts STOP at everything scores high recall for free; the alarm rate is what tells you whether the recall meant anything.

| Detector | n | Alarm rate | Recall | Precision | FN | Accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| LLM (ollama:llama3.2) run 1 | 150 | 92.0% | 93.9% | 67.4% | 6 | 66.0% |
| LLM (ollama:llama3.2) run 2 | 150 | 97.3% | 98.0% | 66.4% | 2 | 66.0% |
| Single-sensor baseline (full set) | 593 | 36.8% | 55.5% | 100.0% | 175 | 70.5% |
| **Compound engine (full set)** | 593 | 68.3% | **100.0%** | 97.0% | **0** | 98.0% |

### What the recall number is actually worth

The model answered STOP on **92%–97% of cases**. In this subsample **66%** of cases genuinely require stopping work (99 of 150), so a detector that alarms on nearly everything collects high recall automatically — and its precision lands at 66%–67%, which is approximately the base rate itself.

That is the real finding, and it is worse for the LLM than a simple
"it missed some" reading: asked to judge safety directly, it does not
discriminate. The compound engine reaches 100% recall while alarming on
only the cases that warrant it — that gap, not the recall column, is the
answer to "why not just use GPT-4?".

## Run-to-run agreement

Across 2 runs on identical inputs, the model changed its own answer on **8.0%** of cases.
The rules engine's equivalent number is 0% by construction — it
is a pure function. For a stop-work decision that has to be
defensible after an incident, reproducibility is not a nicety.

## Cost of the comparison

- Latency per judgement: p50 894.04 ms · p95 1150.13 ms
- Unparseable answers (scored as PROCEED): 0

## What is not here

- **OpenAI baseline: NOT RUN — no API key available.** The harness takes `--provider openai_compatible`; it needs only the key to produce the hosted row. No hosted numbers are estimated in its place.
- The LLM detector is **eval-only**. It is not imported by the
  assessment pipeline and cannot affect a shipped verdict.
