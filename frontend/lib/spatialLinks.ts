import type { AssessmentHistoryItem } from "@/lib/liveApi";

export interface SpatialLinkView {
  from_asset_id: string;
  to_asset_id: string;
  from_label: string;
  to_label: string;
  relation: string;
  distance_m: number;
  floors_apart: number;
  reason: string;
}

export function spatialLinksFromAssessment(
  assessment: AssessmentHistoryItem | null | undefined,
): SpatialLinkView[] {
  if (!assessment) return [];
  const trace =
    (assessment as AssessmentHistoryItem & { agent_trace?: unknown[] })
      .agent_trace ??
    (assessment.metadata as { agent_trace?: unknown[] } | null)?.agent_trace ??
    [];
  if (!Array.isArray(trace)) return [];
  const links: SpatialLinkView[] = [];
  const seen = new Set<string>();
  for (const raw of trace) {
    if (!raw || typeof raw !== "object") continue;
    const step = raw as Record<string, unknown>;
    const detail =
      step.detail && typeof step.detail === "object"
        ? (step.detail as Record<string, unknown>)
        : {};
    const arr = detail.spatial_links;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const L = item as Record<string, unknown>;
      const key = `${L.from_asset_id}-${L.to_asset_id}-${L.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        from_asset_id: String(L.from_asset_id ?? ""),
        to_asset_id: String(L.to_asset_id ?? ""),
        from_label: String(L.from_label ?? L.from_asset_id ?? ""),
        to_label: String(L.to_label ?? L.to_asset_id ?? ""),
        relation: String(L.relation ?? "NEAR"),
        distance_m: Number(L.distance_m ?? 0),
        floors_apart: Number(L.floors_apart ?? 0),
        reason: String(L.reason ?? ""),
      });
    }
  }
  return links;
}
