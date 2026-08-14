# Model bench — what changes when you swap the model

Generated 2026-08-14T19:36:51+00:00 · 6 case(s) × 2 repeat(s) per provider.

This bench deliberately does **not** measure accuracy against model.
`app/risk/policy.py::classify()` owns `risk_level`; the model writes
prose only. What varies with the model is narration, invented
citations, latency and cost — those are what is measured.

## Measured

| Provider | Model | Runs | Citation-strip rate | Latency p50 | Latency p95 | Cost / assessment | Failure rate | Retry rate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| mock | `langgraph-mock-v1` | 12 | 0.0% (0/0 tokens) | 3 ms | 21 ms | $0.000000 | 0.0% | 0.0% |
| ollama | `llama3.2` | 12 | 0.0% (0/4 tokens) | 6,721 ms | 9,172 ms | $0.000000 | 0.0% | 0.0% |

`mock` makes no network call at all — its narration is a
deterministic template (`agents/llm.py` returns `None`), so its
latency is the graph itself and its cost is zero by construction,
not by measurement. Ollama runs locally: **no API cost**, the cost
is the machine it runs on.

## Not run

- **openai_compatible: NOT RUN** — OPENAI_API_KEY is not set — no request was made

No numbers are estimated for a provider that did not run. The
harness is wired for it; adding the key and re-running this
command fills the row in.

## Verdict invariance — the point of the bench

Same inputs, different model, same verdict. The narration changes;
`risk_level` does not, because the model never writes it.

| Case | mock | ollama |
| --- | --- | --- |
| `nominal_safe` | nominal | nominal |
| `elevated_gas_only` | elevated | elevated |
| `critical_gas_only` | blocking | blocking |
| `vsp_pattern_subcritical` | blocking | blocking |
| `permit_conflict_only` | elevated | elevated |
| `vsp_coke_oven_step1` | blocking | blocking |

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
| openai_compatible | NOT RUN | NOT RUN | NOT RUN |

### If the hosted model were used — PROJECTED, no request made

The prompt size is the same whichever model answers it, so a
hosted bill can be projected from token counts we did measure
(**723 in / 297 out** per assessment, measured on
`ollama:llama3.2`) times published list
prices. **This is arithmetic, not a benchmark result: no OpenAI
request was made.** The measured hosted row stays empty until a
key exists.

| Hosted model | $/1M in · out | $/assessment | $/day | $/year |
| --- | --- | ---: | ---: | ---: |
| gpt-4o-mini | $0.15 · $0.60 | $0.000287 | $0.11 | $41.85 |
| gpt-4o | $2.50 · $10.00 | $0.004777 | $1.91 | $697.51 |

Against a single lost-time process incident, conventionally costed
in the millions, the annual model spend above is the rounding error
— but note the honest form of the claim: this compares a *running
cost* to a *prevented loss*, and prevention is what the eval
measures, not this table.

## Raw

```json
{
  "generated_at": "2026-08-14T19:36:51+00:00",
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
      "ollama": "nominal"
    },
    "elevated_gas_only": {
      "mock": "elevated",
      "ollama": "elevated"
    },
    "critical_gas_only": {
      "mock": "blocking",
      "ollama": "blocking"
    },
    "vsp_pattern_subcritical": {
      "mock": "blocking",
      "ollama": "blocking"
    },
    "permit_conflict_only": {
      "mock": "elevated",
      "ollama": "elevated"
    },
    "vsp_coke_oven_step1": {
      "mock": "blocking",
      "ollama": "blocking"
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
        "mean_ms": 6.16,
        "p50_ms": 3.27,
        "p95_ms": 20.59
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
      "model": "llama3.2",
      "runs": 12,
      "successes": 12,
      "failure_rate": 0.0,
      "retry_rate": 0.0,
      "latency_ms": {
        "count": 12,
        "mean_ms": 6458.54,
        "p50_ms": 6721.02,
        "p95_ms": 9171.95
      },
      "citation_strip_rate": 0.0,
      "citation_token_strip_rate": 0.0,
      "citations_cited": 4,
      "citations_stripped": 0,
      "mean_tokens_in": 722.8,
      "mean_tokens_out": 296.8,
      "mean_cost_usd_per_assessment": 0.0,
      "projected_cost_usd_per_day": 0.0,
      "projected_cost_usd_per_year": 0.0
    },
    {
      "provider": "openai_compatible",
      "status": "NOT RUN",
      "reason": "OPENAI_API_KEY is not set \u2014 no request was made"
    }
  ],
  "hosted_cost_projection": {
    "basis": "PROJECTED \u2014 no OpenAI request was made",
    "token_counts_measured_on": "ollama:llama3.2",
    "mean_tokens_in": 722.8,
    "mean_tokens_out": 296.8,
    "assessments_per_day_assumption": 400,
    "rows": [
      {
        "model": "gpt-4o-mini",
        "price_per_1m_in_out": [
          0.15,
          0.6
        ],
        "usd_per_assessment": 0.00028665,
        "usd_per_day": 0.1147,
        "usd_per_year": 41.85
      },
      {
        "model": "gpt-4o",
        "price_per_1m_in_out": [
          2.5,
          10.0
        ],
        "usd_per_assessment": 0.0047775,
        "usd_per_day": 1.911,
        "usd_per_year": 697.51
      }
    ]
  }
}
```
