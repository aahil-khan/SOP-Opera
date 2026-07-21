# Pitch one-pager — Compound risk, caught in time

**Claim:** Single sensors stay silent until gas hits critical. SOP Opera fuses
sub-critical gas + hot work + worker-in-zone, blocks earlier, and cites Indian
regs — with a human decision and an immutable audit trail.

## Headline numbers (labeled harness)

| Detector | Accuracy | FN rate |
| --- | ---: | ---: |
| Single-sensor (critical OR) | 76.5% | **66.7%** |
| Predictive forecast (trend) | 82.4% | 16.7% |
| **Compound engine** | **94.1%** | **0.0%** |

- **FN reduction vs single-sensor: 100%**
- **VSP lead time: 18s** in the timed demo (forecast 4s → compound 8s → single critical 26s). In production this maps to minutes/hours, not seconds.

## Demo beat (90 seconds)

1. Run **vsp_coke_oven** on Digital Twin.
2. At ~8s: compound **blocking** while gas is still below critical — single-sensor silent.
3. Open **Eval** (nav) — show FN cut + lead time.
4. Supervisor decision → close / escalate as needed.
5. Webhook curl → Vessel A elevated → same twin path; show `/api/assessment-jobs/queue`.

## Where to look live

- Nav → **Eval** → FN table, 3-lane VSP timeline, threshold editor
- API → `GET /api/eval/summary`, `GET|PUT /api/config/thresholds`
- Source report → `docs/eval-report.md`

## Curl demo (SCADA adapter)

```bash
curl -s -X POST http://localhost:8000/api/ingest/webhook \
  -H 'Content-Type: application/json' \
  -d '{
    "source_system": "scada-historian",
    "asset_name": "Vessel A",
    "readings": [{"metric": "gas_reading", "value": 28.0, "unit": "ppm"}]
  }'

curl -s http://localhost:8000/api/assessment-jobs/queue
```

See [architecture-ingest.md](./architecture-ingest.md).

## Framing for judges

- Not predictive maintenance ML — **agentic Operational Review** at go/no-go.
- Geospatial evidence = twin risk coloring + breathing + spatial proximity links.
- CCTV / autonomous emergency orchestrator = roadmap, not this demo.
