# LLM-as-detector baseline

Generated 2026-08-19T06:17:25+00:00.

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
| LLM (openai_compatible:gpt-4o-mini) run 1 | 150 | 98.7% | 100.0% | 66.9% | 0 | 67.3% |
| LLM (openai_compatible:gpt-4o-mini) run 2 | 150 | 97.3% | 100.0% | 67.8% | 0 | 68.7% |
| Single-sensor baseline (full set) | 593 | 36.8% | 55.5% | 100.0% | 175 | 70.5% |
| **Compound engine (full set)** | 593 | 68.3% | **100.0%** | 97.0% | **0** | 98.0% |

### What the recall number is actually worth

The model answered STOP on **97%–99% of cases**. In this subsample **66%** of cases genuinely require stopping work (99 of 150), so a detector that alarms on nearly everything collects high recall automatically — and its precision lands at 67%–68%, which is approximately the base rate itself.

That is the real finding, and it is worse for the LLM than a simple
"it missed some" reading: asked to judge safety directly, it does not
discriminate. The compound engine reaches 100% recall while alarming on
only the cases that warrant it — that gap, not the recall column, is the
answer to "why not just use GPT-4?".

## Run-to-run agreement

Across 2 runs on identical inputs, the model changed its own answer on **1.3%** of cases.
The rules engine's equivalent number is 0% by construction — it
is a pure function. For a stop-work decision that has to be
defensible after an incident, reproducibility is not a nicety.

## Cost of the comparison

- Latency per judgement: p50 973.34 ms · p95 1304.53 ms
- Unparseable answers (scored as PROCEED): 0

## What is not here

- **OpenAI baseline: RUN — the rows above are the hosted model.** Cross-check against the local-model run in `docs/llm-detector-baseline.md`: both land in the same place, so the finding is a property of asking an LLM to judge safety directly, not an artefact of one model's size.
- The LLM detector is **eval-only**. It is not imported by the
  assessment pipeline and cannot affect a shipped verdict.
