import type { Context, DerivedFact } from "@/shared/schemas";
import type { TelemetrySample, TelemetryStatusChip } from "@/lib/liveStore";

/** Per-asset ops signals derived from live telemetry status chips. */
export interface AssetOpsChips {
  /** Asset has a permit status chip (any status). */
  hasPermit: boolean;
  /** Active permit-to-work on this asset (warn). */
  permitActive: boolean;
  /** Asset has an isolation status chip. */
  hasIsolation: boolean;
  /** Isolation incomplete / not locked out (warn). */
  isolationIncomplete: boolean;
  /** Count of worker_location chips for this asset. */
  workerCount: number;
  /** Worker flagged in a hazardous zone, or PPE missing (warn). */
  workerHazardous: boolean;
}

const STATUS_CATEGORIES = new Set([
  "permit",
  "isolation_status",
  "worker_location",
  "ppe_status",
]);

function emptyChips(): AssetOpsChips {
  return {
    hasPermit: false,
    permitActive: false,
    hasIsolation: false,
    isolationIncomplete: false,
    workerCount: 0,
    workerHazardous: false,
  };
}

function applyCategory(
  cur: AssetOpsChips,
  category: string,
  label: string,
): void {
  const lower = label.toLowerCase();
  if (category === "permit") {
    cur.hasPermit = true;
    if (lower.includes("active")) cur.permitActive = true;
  } else if (category === "isolation_status") {
    cur.hasIsolation = true;
    if (lower.includes("incomplete")) cur.isolationIncomplete = true;
  } else if (category === "worker_location") {
    cur.workerCount += 1;
    if (lower.includes("hazardous")) cur.workerHazardous = true;
  } else if (category === "ppe_status") {
    if (lower.includes("missing") || lower.includes("non")) {
      cur.workerHazardous = true;
    }
  }
}

function labelFromPayload(
  category: string,
  payload: Record<string, unknown>,
): string {
  if (category === "permit") {
    return `Permit ${String(payload.status ?? "?")} · ${String(payload.work_type ?? "").replaceAll("_", " ")}`;
  }
  if (category === "isolation_status") {
    return payload.complete ? "Isolation complete" : "Isolation incomplete";
  }
  if (category === "worker_location") {
    return `Worker · ${String(payload.zone ?? "?")}`;
  }
  if (category === "ppe_status") {
    return payload.compliant === false
      ? `PPE missing ${String(payload.missing ?? "")}`
      : "PPE compliant";
  }
  return category;
}

function labelFromSample(sample: TelemetrySample): string {
  return labelFromPayload(sample.category, sample.payload);
}

function ensure(out: Record<string, AssetOpsChips>, assetId: string): AssetOpsChips {
  const cur = out[assetId] ?? emptyChips();
  out[assetId] = cur;
  return cur;
}

/**
 * Classify telemetry into per-asset ops signals.
 * Prefers durable per-source:asset samples, then the rolling status chip list
 * (same classification as OverviewPanel).
 */
export function buildOpsChipsByAsset(
  telemetryStatus: TelemetryStatusChip[],
  telemetryBySource?: Record<string, TelemetrySample>,
): Record<string, AssetOpsChips> {
  const out: Record<string, AssetOpsChips> = {};

  if (telemetryBySource) {
    for (const [key, sample] of Object.entries(telemetryBySource)) {
      // Skip bare source keys like "scada" / "ptw" without an asset id.
      if (!key.includes(":")) continue;
      if (!STATUS_CATEGORIES.has(sample.category)) continue;
      applyCategory(
        ensure(out, sample.asset_id),
        sample.category,
        labelFromSample(sample),
      );
    }
  }

  for (const chip of telemetryStatus) {
    if (!STATUS_CATEGORIES.has(chip.category)) continue;
    applyCategory(ensure(out, chip.asset_id), chip.category, chip.label);
  }

  return out;
}

/** Fold open-review context + derived facts into ops chips (demo / hard ingest). */
export function mergeReviewOpsIntoChips(
  base: Record<string, AssetOpsChips>,
  details: Record<
    string,
    {
      asset: { id: string };
      review: { state: string };
      context: Context[];
      derived_facts: DerivedFact[];
    }
  >,
): Record<string, AssetOpsChips> {
  const out: Record<string, AssetOpsChips> = { ...base };
  for (const id of Object.keys(out)) {
    out[id] = { ...out[id] };
  }

  for (const detail of Object.values(details)) {
    if (detail.review.state === "closed") continue;
    const assetId = detail.asset.id;

    for (const ctx of detail.context) {
      if (!STATUS_CATEGORIES.has(ctx.category)) continue;
      applyCategory(
        ensure(out, assetId),
        ctx.category,
        labelFromPayload(ctx.category, ctx.payload),
      );
    }

    for (const fact of detail.derived_facts) {
      if (!(fact.value === true || fact.value === "true")) continue;
      const cur = ensure(out, assetId);
      switch (fact.fact_type) {
        case "permit_conflict":
        case "simultaneous_ops":
        case "lifting_operation_conflict":
          cur.hasPermit = true;
          cur.permitActive = true;
          break;
        case "zone_occupied":
          cur.workerCount = Math.max(cur.workerCount, 1);
          cur.workerHazardous = true;
          break;
        case "incomplete_isolation":
          cur.hasIsolation = true;
          cur.isolationIncomplete = true;
          break;
        case "ppe_noncompliance":
          cur.workerHazardous = true;
          break;
        default:
          break;
      }
    }
  }

  return out;
}

export function hasAnyOpsChip(chips: AssetOpsChips | undefined): boolean {
  if (!chips) return false;
  return (
    chips.hasPermit ||
    chips.hasIsolation ||
    chips.workerCount > 0 ||
    chips.workerHazardous
  );
}

export function countAssetsWithOps(
  byAsset: Record<string, AssetOpsChips>,
): number {
  let n = 0;
  for (const chips of Object.values(byAsset)) {
    if (hasAnyOpsChip(chips)) n += 1;
  }
  return n;
}

export function opsChipsByAssetEqual(
  a: Record<string, AssetOpsChips>,
  b: Record<string, AssetOpsChips>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    const ca = a[k];
    const cb = b[k];
    if (!cb) return false;
    if (
      ca.hasPermit !== cb.hasPermit ||
      ca.permitActive !== cb.permitActive ||
      ca.hasIsolation !== cb.hasIsolation ||
      ca.isolationIncomplete !== cb.isolationIncomplete ||
      ca.workerCount !== cb.workerCount ||
      ca.workerHazardous !== cb.workerHazardous
    ) {
      return false;
    }
  }
  return true;
}

/** Rebuild ops chips; keep prior reference when classification unchanged. */
export function refreshOpsChipsByAsset(
  prev: Record<string, AssetOpsChips>,
  telemetryStatus: TelemetryStatusChip[],
  telemetryBySource: Record<string, TelemetrySample>,
  reviewDetails?: Record<
    string,
    {
      asset: { id: string };
      review: { state: string };
      context: Context[];
      derived_facts: DerivedFact[];
    }
  >,
): Record<string, AssetOpsChips> {
  const fromTelemetry = buildOpsChipsByAsset(telemetryStatus, telemetryBySource);
  const next = reviewDetails
    ? mergeReviewOpsIntoChips(fromTelemetry, reviewDetails)
    : fromTelemetry;
  return opsChipsByAssetEqual(prev, next) ? prev : next;
}

/** Plant-wide ops KPI counters derived from per-asset chips. */
export interface OpsSummary {
  peopleAtRisk: number;
  activePermits: number;
  incompleteIsolations: number;
  assetsWithOps: number;
}

export const EMPTY_OPS_SUMMARY: OpsSummary = {
  peopleAtRisk: 0,
  activePermits: 0,
  incompleteIsolations: 0,
  assetsWithOps: 0,
};

export function summarizeOpsChips(
  byAsset: Record<string, AssetOpsChips>,
): OpsSummary {
  let peopleAtRisk = 0;
  let activePermits = 0;
  let incompleteIsolations = 0;
  let assetsWithOps = 0;
  for (const chips of Object.values(byAsset)) {
    if (hasAnyOpsChip(chips)) assetsWithOps += 1;
    if (chips.permitActive) activePermits += 1;
    if (chips.isolationIncomplete) incompleteIsolations += 1;
    if (chips.workerHazardous) peopleAtRisk += 1;
  }
  return {
    peopleAtRisk,
    activePermits,
    incompleteIsolations,
    assetsWithOps,
  };
}

export function opsSummaryEqual(a: OpsSummary, b: OpsSummary): boolean {
  return (
    a.peopleAtRisk === b.peopleAtRisk &&
    a.activePermits === b.activePermits &&
    a.incompleteIsolations === b.incompleteIsolations &&
    a.assetsWithOps === b.assetsWithOps
  );
}

export function refreshOpsSummary(
  prev: OpsSummary,
  byAsset: Record<string, AssetOpsChips>,
): OpsSummary {
  const next = summarizeOpsChips(byAsset);
  return opsSummaryEqual(prev, next) ? prev : next;
}
