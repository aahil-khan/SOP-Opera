# Proposed diff 001 — `CoverageState` in `shared/`

**Owner of the file:** Aahil (choke point: `shared/**` + `shared/python/schemas.py`)
**Requested by:** Maulik · Track B / W3a · 14 Aug 2026
**Status:** proposed — NOT applied on `feat/providers`

## What this is

W3a ("blind, not safe") introduces sensor **coverage** as a field carried *alongside*
`risk_level`, never inside it. `RiskLevel` stays exactly `nominal | elevated | blocking`
(decision I5). Coverage needs a canonical home in `shared/` because both languages read it.

## Why it is not already merged

`shared/**` is a choke point and the TS file plus its hand-kept Python mirror must move
together. The branch works without this diff: the backend declares the same union locally in
[coverage.py:34](../../backend/app/context/coverage.py#L34) (`CoverageState`) and the frontend
in [sensorThresholds.ts:26](../../frontend/lib/sensorThresholds.ts#L26). Both are additive
literal unions with identical members, so applying this diff and switching the two imports is
mechanical — nothing else changes.

## The diff (additive only)

### `shared/enums.ts`

Add after the `RiskLevel` line, so the two sit next to each other and the comment explains
why they are separate types:

```diff
 export type RiskLevel = "nominal" | "elevated" | "blocking";

+/**
+ * Sensor coverage — how much the platform could actually see when it judged.
+ *
+ * Deliberately NOT a value in RiskLevel: "we have no data" is not a severity,
+ * and folding it in would make every consumer of RiskLevel (the FSM, the risk
+ * policy, the eval harness) treat missing data as a verdict. Coverage rides
+ * alongside risk_level and never changes it — a blind channel withholds the
+ * nominal claim rather than raising or blocking.
+ */
+export type CoverageState = "assessed" | "degraded" | "blind";
+
 export type DecisionOutcome =
```

### `shared/python/schemas.py`

The hand-kept mirror, same placement:

```diff
 RiskLevel = Literal["nominal", "elevated", "blocking"]
+# Sensor coverage — orthogonal to RiskLevel, never a value inside it. See the
+# docstring on the TS twin in shared/enums.ts.
+CoverageState = Literal["assessed", "degraded", "blind"]
 DecisionOutcome = Literal["approved", "approved_with_conditions", "blocked"]
```

## After it merges

Three one-line follow-ups, which I'll do:

1. `backend/app/context/coverage.py` — delete the local `CoverageState` and import it from
   `shared.python.schemas`.
2. `backend/app/context/schemas.py` — `AssetCoverageOut.coverage` uses the shared type
   instead of the inline `Literal`.
3. `frontend/lib/sensorThresholds.ts` — re-export from `@/shared/enums` instead of declaring.

No behavior change in any of the three; `node scripts/sync-shared.mjs` regenerates
`frontend/shared/` as usual.

## Risk

Additive union with no existing consumer, so nothing can narrow or break. The one thing worth
guarding is the reason it exists: if a future change adds `blind` to `RiskLevel` instead, the
FSM, `classify()` and the eval harness all inherit an unrelated concept at once — which is
exactly what decision I5 forbids.
