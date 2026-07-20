import type { ReviewState } from "@/shared/enums";
import type { LiveAssetView } from "@/lib/liveStore";
import { openWorkDisplayRisk } from "@/lib/sensorThresholds";

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
  if (column === "awaiting_decision") {
    if (state === "decided") return "Close review";
    return "Decide PROCEED / BLOCK";
  }
  return "None";
}

export type WorkBadgeRisk =
  | "nominal"
  | "elevated"
  | "blocking"
  | "critical"
  | "halted";

export type WorkStatusKind =
  | "investigating"
  | "awaiting_decision"
  | "decided"
  | "halted"
  | "conditional"
  | "closed";

export function workStatusForView(view: LiveAssetView): {
  kind: WorkStatusKind;
  label: string;
  badgeRisk: WorkBadgeRisk;
  nextAction: string;
  resolved: boolean;
} {
  const review = view.review;
  const state = review?.state;
  const outcome = view.detail?.decision?.outcome;

  if (state === "closed") {
    if (outcome === "blocked") {
      return {
        kind: "halted",
        label: view.sensor_critical ? "Halted · sensor critical" : "Work halted",
        badgeRisk: "halted",
        nextAction: view.sensor_critical
          ? "Sensors still above incident threshold — keep offline"
          : "Incident closed — no further action",
        resolved: true,
      };
    }
    if (outcome === "approved_with_conditions") {
      return {
        kind: "conditional",
        label: "Closed · conditions",
        badgeRisk: "elevated",
        nextAction:
          view.detail?.decision?.conditions?.trim() ||
          "Verify stated conditions before restart",
        resolved: true,
      };
    }
    if (view.sensor_critical) {
      return {
        kind: "closed",
        label: "Closed · sensor critical",
        badgeRisk: "critical",
        nextAction: "Live sensors still critical — verify before restart",
        resolved: true,
      };
    }
    return {
      kind: "closed",
      label: "Closed",
      badgeRisk: "nominal",
      nextAction: "None",
      resolved: true,
    };
  }

  if (state === "decided") {
    const badgeRisk: WorkBadgeRisk =
      outcome === "blocked"
        ? "blocking"
        : outcome === "approved_with_conditions"
          ? "elevated"
          : "nominal";
    return {
      kind: "decided",
      label:
        outcome === "blocked"
          ? "Decided · blocked"
          : `Decided · ${(outcome ?? "unknown").replaceAll("_", " ")}`,
      badgeRisk,
      nextAction: "Close review",
      resolved: false,
    };
  }

  const column = columnForReviewState(state);
  const displayRisk = openWorkDisplayRisk(
    view.risk_level,
    view.sensor_critical,
  ) as WorkBadgeRisk;

  if (column === "awaiting_decision") {
    return {
      kind: "awaiting_decision",
      label: displayRisk,
      badgeRisk: displayRisk,
      nextAction:
        view.assessment?.recommendations?.[0]?.text?.trim() ??
        fallbackNextAction(column, state),
      resolved: false,
    };
  }

  return {
    kind: "investigating",
    label: displayRisk,
    badgeRisk: displayRisk,
    nextAction: fallbackNextAction(column, state),
    resolved: false,
  };
}

export function nextActionForView(view: LiveAssetView): string {
  return workStatusForView(view).nextAction;
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
