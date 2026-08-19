# Model bench — what changes when you swap the model

Generated 2026-08-19T06:39:53+00:00 · 6 case(s) × 2 repeat(s) per provider.

This bench deliberately does **not** measure accuracy against model.
`app/risk/policy.py::classify()` owns `risk_level`; the model writes
prose only. What varies with the model is narration, invented
citations, latency and cost — those are what is measured.

## Measured

| Provider | Model | Runs | Citation-strip rate | Agent latency p50 | Agent latency p95 | Cost / assessment | Failure rate | Retry rate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| mock | `langgraph-mock-v1` | 12 | 0.0% (0/0 tokens) | 15 ms | 40 ms | $0.000000 | 0.0% | 0.0% |
| ollama | `phi3:mini` | 12 | 0.0% (0/6 tokens) | 39,275 ms | 74,006 ms | $0.000000 | 41.7% | 50.0% |
| openai_compatible | `gpt-4o-mini` | 12 | 0.0% (0/10 tokens) | 5,196 ms | 6,094 ms | $0.000255 | 0.0% | 0.0% |

**Read the columns for exactly what they measure.**

- *Citation-strip rate* is stripped ÷ cited tokens, and the denominator is printed because it is small: a 0% over few or no cited tokens means the models rarely cited at all on this case set, not that hallucination was ruled out.
- *Agent latency* is wall-clock around the LangGraph run only. It **excludes** retrieval, DB persistence and time queued — so it is not end-to-end assessment latency and should not be quoted as "time to a verdict on screen".
- *Cost* is priced by `estimate_cost_usd()`, which covers OpenAI-compatible models only (`agents/llm.py:149-154`). A $0 row for `mock` or `ollama` means unpriced, not free — for `ollama` the real cost is the machine it runs on.

`mock` makes no network call at all — its narration is a
deterministic template (`agents/llm.py` returns `None`), so its
latency is the graph itself and its cost is zero by construction,
not by measurement. Ollama runs locally: **no API cost**, the cost
is the machine it runs on.

## Verdict invariance — the point of the bench

Same inputs, different model, same verdict. The narration changes;
`risk_level` does not, because the model never writes it.

| Case | mock | ollama | openai_compatible |
| --- | --- | --- | --- |
| `nominal_safe` | nominal | nominal | nominal |
| `elevated_gas_only` | elevated | elevated | elevated |
| `critical_gas_only` | blocking | blocking | blocking |
| `vsp_pattern_subcritical` | blocking | — | blocking |
| `permit_conflict_only` | elevated | — | elevated |
| `vsp_coke_oven_step1` | blocking | blocking | blocking |

**Verdict identical across every measured provider: yes**

## Cost projection (W9c) — PROJECTED, not measured

Measured per-assessment cost above, extrapolated on a stated
assumption of **400 assessments/day** at
plant scale. Everything in this section is arithmetic on the
measured number, labelled as an estimate.

| Provider | Cost / assessment (MEASURED) | Per day (PROJECTED) | Per year (PROJECTED) |
| --- | ---: | ---: | ---: |
| mock | $0.000000 | $0.00 | $0.00 |
| ollama | $0.000000 | $0.00 | $0.00 |
| openai_compatible | $0.000255 | $0.10 | $37.28 |

### If the hosted model were used — PROJECTED, no request made

The prompt size is the same whichever model answers it, so a
hosted bill can be projected from token counts we did measure
(**629 in / 332 out** per assessment, measured on
`ollama:phi3:mini`) times published list
prices. **This is arithmetic, not a benchmark result: no OpenAI
request was made.** The measured hosted row stays empty until a
key exists.

| Hosted model | $/1M in · out | $/assessment | $/day | $/year |
| --- | --- | ---: | ---: | ---: |
| gpt-4o-mini | $0.15 · $0.60 | $0.000294 | $0.12 | $42.86 |
| gpt-4o | $2.50 · $10.00 | $0.004893 | $1.96 | $714.31 |

Against a single lost-time process incident, conventionally costed
in the millions, the annual model spend above is the rounding error
— but note the honest form of the claim: this compares a *running
cost* to a *prevented loss*, and prevention is what the eval
measures, not this table.

## Raw

```json
{
  "generated_at": "2026-08-19T06:39:53+00:00",
  "cases": [
    "nominal_safe",
    "elevated_gas_only",
    "critical_gas_only",
    "vsp_pattern_subcritical",
    "permit_conflict_only",
    "vsp_coke_oven_step1"
  ],
  "repeats": 2,
  "verdict_invariant_across_measured_providers": true,
  "invariance": {
    "nominal_safe": {
      "mock": "nominal",
      "ollama": "nominal",
      "openai_compatible": "nominal"
    },
    "elevated_gas_only": {
      "mock": "elevated",
      "ollama": "elevated",
      "openai_compatible": "elevated"
    },
    "critical_gas_only": {
      "mock": "blocking",
      "ollama": "blocking",
      "openai_compatible": "blocking"
    },
    "vsp_pattern_subcritical": {
      "mock": "blocking",
      "ollama": null,
      "openai_compatible": "blocking"
    },
    "permit_conflict_only": {
      "mock": "elevated",
      "ollama": null,
      "openai_compatible": "elevated"
    },
    "vsp_coke_oven_step1": {
      "mock": "blocking",
      "ollama": "blocking",
      "openai_compatible": "blocking"
    }
  },
  "providers": [
    {
      "provider": "mock",
      "status": "measured",
      "model": "langgraph-mock-v1",
      "runs": 12,
      "successes": 12,
      "failure_rate": 0.0,
      "retry_rate": 0.0,
      "latency_ms": {
        "count": 12,
        "mean_ms": 19.45,
        "p50_ms": 15.16,
        "p95_ms": 40.25
      },
      "citation_strip_rate": 0.0,
      "citation_token_strip_rate": 0.0,
      "citations_cited": 0,
      "citations_stripped": 0,
      "mean_tokens_in": 0.0,
      "mean_tokens_out": 0.0,
      "mean_cost_usd_per_assessment": 0.0,
      "projected_cost_usd_per_day": 0.0,
      "projected_cost_usd_per_year": 0.0
    },
    {
      "provider": "ollama",
      "status": "measured",
      "model": "phi3:mini",
      "runs": 12,
      "successes": 7,
      "failure_rate": 0.4167,
      "retry_rate": 0.5,
      "latency_ms": {
        "count": 7,
        "mean_ms": 42464.66,
        "p50_ms": 39274.72,
        "p95_ms": 74006.1
      },
      "citation_strip_rate": 0.0,
      "citation_token_strip_rate": 0.0,
      "citations_cited": 6,
      "citations_stripped": 0,
      "mean_tokens_in": 628.9,
      "mean_tokens_out": 332.3,
      "mean_cost_usd_per_assessment": 0.0,
      "projected_cost_usd_per_day": 0.0,
      "projected_cost_usd_per_year": 0.0
    },
    {
      "provider": "openai_compatible",
      "status": "measured",
      "model": "gpt-4o-mini",
      "runs": 12,
      "successes": 12,
      "failure_rate": 0.0,
      "retry_rate": 0.0,
      "latency_ms": {
        "count": 12,
        "mean_ms": 5061.26,
        "p50_ms": 5195.73,
        "p95_ms": 6094.12
      },
      "citation_strip_rate": 0.0,
      "citation_token_strip_rate": 0.0,
      "citations_cited": 10,
      "citations_stripped": 0,
      "mean_tokens_in": 626.5,
      "mean_tokens_out": 268.9,
      "mean_cost_usd_per_assessment": 0.00025532,
      "projected_cost_usd_per_day": 0.1021,
      "projected_cost_usd_per_year": 37.28
    }
  ],
  "hosted_cost_projection": {
    "basis": "PROJECTED \u2014 no OpenAI request was made",
    "token_counts_measured_on": "ollama:phi3:mini",
    "mean_tokens_in": 628.9,
    "mean_tokens_out": 332.3,
    "assessments_per_day_assumption": 400,
    "rows": [
      {
        "model": "gpt-4o-mini",
        "price_per_1m_in_out": [
          0.15,
          0.6
        ],
        "usd_per_assessment": 0.00029355,
        "usd_per_day": 0.1174,
        "usd_per_year": 42.86
      },
      {
        "model": "gpt-4o",
        "price_per_1m_in_out": [
          2.5,
          10.0
        ],
        "usd_per_assessment": 0.0048925,
        "usd_per_day": 1.957,
        "usd_per_year": 714.31
      }
    ]
  }
}
```
