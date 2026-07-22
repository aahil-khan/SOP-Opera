# Business Impact & ROI — SOP Opera

*The money slide. Every ₹ figure below is tagged **[cited]** (public source) or
**[modeled]** (our estimate with a stated assumption). The strongest card we have is
honesty — do not round a modeled number up and present it as fact in Q&A.*

---

## The one line for the slide

> **One prevented compound-risk incident pays for a plant-wide SOP Opera deployment
> many times over — and India has ~1,861 Major Accident Hazard units where the warning
> data already exists in separate systems but is never fused at the decision.**

The premise is not "install more sensors." At Visakhapatnam the gas sensors, the
permit-to-work system and SCADA all existed — the signal was present, nobody synthesized
it in time. SOP Opera is the synthesis layer. Its value is the incidents it prevents.

---

## 1. What one major incident costs (bottom-up)

A single multi-fatality process incident (coke-oven / gas / hot-work class — the VSP
pattern) carries four cost blocks:

| Cost block | Basis | Figure |
| --- | --- | --- |
| **Human / compensation** | VSP: ₹1.72 cr per regular employee, ₹45.75 lakh per contract worker + ₹25 lakh ex-gratia **[cited]**. ~8 fatalities. | **₹6–14 cr** |
| **Production downtime** | A coke-oven battery / steel melt shop out for investigation + repair. 15–45 days at ₹1–3 cr/day contribution loss for a large integrated unit **[modeled]**. | **₹15–100+ cr** |
| **Regulatory penalty** | Dahej boiler blast: NGT ₹25 cr **[cited]**; Sterlite: ₹100 cr **[cited]**. Conservative provision. | **₹10–25 cr** |
| **Asset damage, investigation, legal, reputational** | Plant rebuild, statutory inquiry, litigation, brand/insurance **[modeled]**. | **₹10–30 cr** |

**Conservative all-in per major incident: ~₹50 crore.** Headline (VSP-scale, extended
outage): **₹100–150 crore+.** We anchor the model on ₹50 cr to stay defensible.

*Sources: VSP compensation and Dahej/Sterlite penalties are public (see Sources). Downtime
and asset/reputational blocks are modeled ranges — we say so on the slide.*

---

## 2. Why SOP Opera is positioned to prevent them — from our own eval

This is the bridge from "safety story" to "money." Our evaluation harness
(`docs/eval-report.md`) scores detectors against 593 labeled plant states drawn from the
statutory stop-work criteria:

- A conventional single-sensor SCADA threshold alarm **misses 175 of 393 states where a
  regulation requires stopping work — a 44.5% false-negative rate.**
- The SOP Opera compound engine **misses zero (0.0% FN)** on the same independent labels,
  and blocks the VSP scenario **28 minutes earlier** (at sub-critical gas).

So the prevention claim is not marketing — it is exactly the class of miss (compound
conditions no single sensor flags) that precedes VSP-type incidents. **44.5% → 0% on the
metric that actually saves lives.** (FICCI 2024: 60% of large facilities still coordinate
these systems by manual handoff — the gap SOP Opera closes.)

---

## 3. Per-plant ROI (the cleanest slide)

The honest framing isn't "we prevent every incident." It's that **preventing even one
compound-risk incident over the deployment's life dwarfs its cost.**

| | Figure |
| --- | --- |
| Cost of one prevented major incident | **~₹50 cr** (conservative, §1) |
| Plausible SOP Opera cost for one plant (software + integration + ops, modeled) | **< ₹1–2 cr/yr** |
| Break-even | **One prevented incident pays for ~25–50 plant-years** |

Even valued purely on **near-miss reduction** (far more frequent than fatalities) and
**faster incident reconstruction** (the frozen audit packet turns weeks of cross-system
log-pulling into seconds), the platform clears its cost long before a single life-safety
event is counted.

---

## 4. National addressable model

| Input | Value | Source |
| --- | --- | --- |
| Major Accident Hazard (MAH) units in India | **~1,861** | NDMA **[cited]** |
| Registered-factory fatalities / year | **~1,109** (avg to 2020); ~3/day | DGFASLI **[cited]** |
| Broader industrial fatal accidents / year | **~6,500** | DGFASLI (brief) **[cited]** |
| Facilities relying on manual cross-system handoffs | **60%** | FICCI 2024 **[cited]** |
| Cost per major incident | **~₹50 cr** | §1 **[modeled]** |

**Illustrative addressable value:** if a compound-risk intelligence layer across MAH units
prevents even a **modest fraction** of the compound-cause major incidents each year, at
~₹50 cr each, the avoided national loss runs to **hundreds of crores per year** — before
counting the human cost, which is the reason the brief exists. We present this as an
order-of-magnitude addressable market, not a revenue forecast.

---

## 5. Customer & rollout

- **Buyer:** Plant Operations / EHS leadership at MAH-class facilities (steel, refining,
  petrochemicals, fertilizer).
- **Workflow change:** every high-risk permit gets a short, structured Operational Review
  before authorization — a decision that already happens today via paper, phone and SCADA
  screens, now made explainable and auditable.
- **Land-and-expand:** one battery / unit → one plant → operator's fleet. The simulator is
  the same `ContextProvider` seam a real SCADA / SAP / PTW integration plugs into.

---

## Honesty notes (say these before a judge asks)

- Downtime, asset and platform-cost figures are **modeled ranges**, labeled as such. The
  compensation and penalty figures are **cited**.
- The prevention claim rests on **criterion coverage** (we catch the stop-work states a
  single sensor misses), not on a generalization claim about unseen incidents — same
  framing as `docs/eval-report.md`.
- We do not claim to prevent 100% of incidents. The ROI holds even at a low prevented
  fraction because one avoided major incident is ~₹50 cr.

---

## Sources

- Vizag Steel Plant compensation (₹1.72 cr / ₹45.75 lakh / ₹25 lakh ex-gratia): [Deccan Herald](https://www.deccanherald.com/india/andhra-pradesh/vizag-steel-plant-accident-kin-of-deceased-workers-to-get-rs-172-crore-compensation-says-deputy-cm-pawan-kalyan-4032668), [Telangana Today](https://telanganatoday.com/families-of-vizag-steel-plant-blast-victims-to-get-up-to-rs-1-72-crore-compensation-pawan-kalyan)
- Dahej boiler blast — NGT ₹25 cr penalty: [Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fboiler-blast-at-chemical-factory-in-dahej-ngt-slaps-penalty-of-rs-25-cr-on-gujarat-based-company-847134.html)
- Sterlite ₹100 cr (₹1 bn) pollution fine: [BBC](https://feeds.bbci.co.uk/news/world-asia-india-21999901)
- ~1,861 MAH units across India: [NDMA — Chemical Hazards](https://ndma.gov.in/Man-made-Hazards/Chemical)
- DGFASLI factory fatality data (~1,109/yr; 3 deaths/day): [IndiaSpend](https://www.indiaspend.com/special-reports/3-workers-die-every-day-in-indian-factories-govt-data-show-850083)
- Problem statement (DGFASLI ~6,500 fatal accidents/yr; FICCI 60% manual handoffs; VSP): `docs/archive/problem statement.md`
- Detector metrics (44.5% → 0% FN, 28-min lead time): `docs/eval-report.md`
