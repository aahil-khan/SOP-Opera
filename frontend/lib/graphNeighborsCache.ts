import { API_BASE } from "@/lib/api";

export interface GraphNeighbor {
  asset_id: string;
  label?: string;
  zone?: string;
  floor?: string;
  relation: string;
  distance_m: number;
  floors_apart: number;
}

export interface GraphNeighborsResult {
  neighbors: GraphNeighbor[];
  count: number;
}

const cache = new Map<string, GraphNeighborsResult>();
const inflight = new Map<string, Promise<GraphNeighborsResult>>();

/** Shared in-flight deduped fetch for graph neighbor lists. */
export async function fetchGraphNeighbors(
  assetId: string,
): Promise<GraphNeighborsResult> {
  const hit = cache.get(assetId);
  if (hit) return hit;

  let pending = inflight.get(assetId);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(`${API_BASE}/graph/neighbors/${assetId}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { neighbors?: GraphNeighbor[] };
        const neighbors = data.neighbors ?? [];
        const result = { neighbors, count: neighbors.length };
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

export function peekGraphNeighborCount(assetId: string): number | null {
  return cache.get(assetId)?.count ?? null;
}
