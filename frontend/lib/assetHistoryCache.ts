import { fetchReports, type ReportSummary } from "@/lib/liveApi";

export interface AssetHistoryResult {
  reports: ReportSummary[];
  count: number;
}

const cache = new Map<string, AssetHistoryResult>();
const inflight = new Map<string, Promise<AssetHistoryResult>>();

/** Shared in-flight deduped fetch for an asset's closure history. */
export async function fetchAssetHistory(
  assetId: string,
): Promise<AssetHistoryResult> {
  const hit = cache.get(assetId);
  if (hit) return hit;

  let pending = inflight.get(assetId);
  if (!pending) {
    pending = (async () => {
      try {
        const reports = await fetchReports({ asset_id: assetId, limit: 20 });
        const result = { reports, count: reports.length };
        cache.set(assetId, result);
        return result;
      } finally {
        inflight.delete(assetId);
      }
    })();
    inflight.set(assetId, pending);
  }
  return pending;
}

export function peekAssetHistory(assetId: string): AssetHistoryResult | null {
  return cache.get(assetId) ?? null;
}
