import type { ReviewState } from "@/shared/enums";
import type { LiveAssetView } from "@/lib/liveStore";

export type OpenWorkColumnId =
  | "investigating"
  | "awaiting_decision"
  | "closed";

export const OPEN_WORK_COLUMNS: {
  id: OpenWorkColumnId;
  label: string;
}[] = [
  { id: "investigating", label: "Investigating" },
  { id: "awaiting_decision", label: "Awaiting decision" },
  { id: "closed", label: "Closed" },
];

export function columnForReviewState(
  state: ReviewState | null | undefined,
): OpenWorkColumnId {
  if (!state) return "investigating";
  if (
    state === "opened" ||
    state === "reopened" ||
    state === "assessing"
  ) {
    return "investigating";
  }
  if (
    state === "pending_decision" ||
    state === "escalated" ||
    state === "decided"
  ) {
    return "awaiting_decision";
  }
  if (state === "closed") return "closed";
  return "investigating";
}

export function fallbackNextAction(
  column: OpenWorkColumnId,
  state?: ReviewState | null,
): string {
  if (column === "investigating") {
    if (state === "assessing") return "Wait for assessment";
    return "Investigate signal";
  }
  if (column === "awaiting_decision") return "Decide PROCEED / BLOCK";
  return "None";
}

export function nextActionForView(view: LiveAssetView): string {
  const rec = view.assessment?.recommendations?.[0]?.text?.trim();
  if (rec) return rec;
  const column = columnForReviewState(view.review?.state);
  return fallbackNextAction(column, view.review?.state);
}

export function ownerNameForView(view: LiveAssetView): string | null {
  const name = view.detail?.area_owner?.name?.trim();
  return name || null;
}

export function isBlockedWork(view: LiveAssetView): boolean {
  if (view.detail?.decision?.outcome === "blocked") return true;
  if (view.assessment?.risk_level === "blocking") return true;
  const summary = view.assessment?.summary?.toUpperCase() ?? "";
  if (summary.includes("BLOCK")) return true;
  return false;
}

export function isElevatedOrBlocking(view: LiveAssetView): boolean {
  return view.risk_level === "elevated" || view.risk_level === "blocking";
}
