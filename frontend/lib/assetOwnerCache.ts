import type { AreaOwner } from "@/shared/schemas";
import { fetchAssetOwner } from "@/lib/liveApi";

const cache = new Map<string, AreaOwner | null>();
const inflight = new Map<string, Promise<AreaOwner | null>>();

/** Deduped owner lookups — DomainRadar + others often hit the same asset. */
export async function fetchAssetOwnerCached(
  assetId: string,
): Promise<AreaOwner | null> {
  if (cache.has(assetId)) return cache.get(assetId) ?? null;

  let pending = inflight.get(assetId);
  if (!pending) {
    pending = fetchAssetOwner(assetId)
      .then((owner) => {
        cache.set(assetId, owner);
        return owner;
      })
      .finally(() => {
        inflight.delete(assetId);
      });
    inflight.set(assetId, pending);
  }
  return pending;
}
