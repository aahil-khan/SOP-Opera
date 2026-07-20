import type { PlantFloor } from "@/shared/enums";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import type { SpatialLinkView } from "@/lib/spatialLinks";
import { spatialLinksFromAssessment } from "@/lib/spatialLinks";

export type FloorMapEntry = {
  x: number;
  y: number;
  hit?: { x: number; y: number; w: number; h: number };
  floor?: PlantFloor;
  label?: string;
};

export type FloorMap = Record<string, FloorMapEntry>;

/** Minimal view shape for spatial links — avoids importing client liveStore. */
export type SpatialLinksView = {
  asset: { id: string };
  review: unknown;
  assessment: AssessmentHistoryItem | null;
};

export type SpatialLinkLine = SpatialLinkView & {
  /** Asset whose assessment produced this link (review context). */
  sourceAssetId?: string;
};
export type { SpatialLinkView };

function assetFloor(assetId: string, map: FloorMap): PlantFloor {
  return map[assetId]?.floor ?? "ground";
}

export function buildFloorSpatialLinks(
  floor: PlantFloor,
  views: SpatialLinksView[],
  map: FloorMap,
): SpatialLinkLine[] {
  const links: SpatialLinkLine[] = [];
  const linkKeys = new Set<string>();

  for (const view of views) {
    if (!view.review) continue;
    const assessmentLinks = spatialLinksFromAssessment(view.assessment);
    for (const link of assessmentLinks) {
      const onFloor =
        assetFloor(link.from_asset_id, map) === floor ||
        assetFloor(link.to_asset_id, map) === floor;
      if (!onFloor) continue;
      const key = `${link.from_asset_id}-${link.to_asset_id}-${link.relation}`;
      if (linkKeys.has(key)) continue;
      linkKeys.add(key);
      links.push({ ...link, sourceAssetId: view.asset.id });
    }
  }

  return links;
}

export function hitBoxCenter(entry: FloorMapEntry): { x: number; y: number } {
  if (!entry.hit) return { x: entry.x, y: entry.y };
  return {
    x: entry.hit.x + entry.hit.w / 2,
    y: entry.hit.y + entry.hit.h / 2,
  };
}

/** Point on the asset hit-box edge facing another world point. */
export function hitBoxEdgeAnchor(
  entry: FloorMapEntry,
  towardX: number,
  towardY: number,
): { x: number; y: number } {
  if (!entry.hit) return { x: entry.x, y: entry.y };
  const cx = entry.hit.x + entry.hit.w / 2;
  const cy = entry.hit.y + entry.hit.h / 2;
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    return { x: cx, y: cy + entry.hit.h / 2 };
  }
  const hw = entry.hit.w / 2;
  const hh = entry.hit.h / 2;
  const s = Math.min(
    Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity,
    Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * s, y: cy + dy * s };
}

export function linkEndpoints(
  link: SpatialLinkLine,
  map: FloorMap,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const from = map[link.from_asset_id];
  const to = map[link.to_asset_id];
  if (!from || !to) return null;
  const toCenter = hitBoxCenter(to);
  const fromCenter = hitBoxCenter(from);
  const a = hitBoxEdgeAnchor(from, toCenter.x, toCenter.y);
  const b = hitBoxEdgeAnchor(to, fromCenter.x, fromCenter.y);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}
