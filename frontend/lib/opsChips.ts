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
    if (lower.includes("missing")) cur.workerHazardous = true;
  }
}

function labelFromSample(sample: TelemetrySample): string {
  const p = sample.payload;
  if (sample.category === "permit") {
    return `Permit ${String(p.status ?? "?")} · ${String(p.work_type ?? "").replaceAll("_", " ")}`;
  }
  if (sample.category === "isolation_status") {
    return p.complete ? "Isolation complete" : "Isolation incomplete";
  }
  if (sample.category === "worker_location") {
    return `Worker · ${String(p.zone ?? "?")}`;
  }
  if (sample.category === "ppe_status") {
    return p.compliant === false
      ? `PPE missing ${String(p.missing ?? "")}`
      : "PPE compliant";
  }
  return sample.category;
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
      const cur = out[sample.asset_id] ?? emptyChips();
      applyCategory(cur, sample.category, labelFromSample(sample));
      out[sample.asset_id] = cur;
    }
  }

  for (const chip of telemetryStatus) {
    const cur = out[chip.asset_id] ?? emptyChips();
    applyCategory(cur, chip.category, chip.label);
    out[chip.asset_id] = cur;
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
): Record<string, AssetOpsChips> {
  const next = buildOpsChipsByAsset(telemetryStatus, telemetryBySource);
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
