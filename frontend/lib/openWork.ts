import type { ReviewState } from "@/shared/enums";
import type { LiveAssetView } from "@/lib/liveStore";
import type { TaskSummary } from "@/lib/liveApi";
import { openWorkDisplayRisk } from "@/lib/sensorThresholds";

export type OpenWorkColumnId =
  | "investigating"
  | "awaiting_decision"
  | "awaiting_fix"
  | "ready_to_close"
  | "closed";

export const OPEN_WORK_COLUMNS: {
  id: OpenWorkColumnId;
  label: string;
  /** Short label for the narrow stage-chip track. */
  shortLabel: string;
}[] = [
  { id: "investigating", label: "Investigating", shortLabel: "Invest." },
  { id: "awaiting_decision", label: "Awaiting decision", shortLabel: "Decide" },
  { id: "awaiting_fix", label: "Awaiting fix", shortLabel: "Fix" },
  { id: "ready_to_close", label: "Ready to close", shortLabel: "Ready" },
  { id: "closed", label: "Closed", shortLabel: "Closed" },
];

/** Map review state only — use columnForView when task_summary is available. */
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
  if (state === "pending_decision") {
    return "awaiting_decision";
  }
  if (state === "decided") return "awaiting_fix";
  if (state === "closed") return "closed";
  return "investigating";
}

export function labelForOpenWorkColumn(id: OpenWorkColumnId): string {
  return OPEN_WORK_COLUMNS.find((c) => c.id === id)?.label ?? id;
}

/** Operator-board stage label from review state alone (no task_summary). */
export function lifecycleLabelForReviewState(
  state: ReviewState | string | null | undefined,
): string {
  return labelForOpenWorkColumn(
    columnForReviewState(state as ReviewState | null | undefined),
  );
}

function followThroughColumn(
  summary: TaskSummary | null | undefined,
): "awaiting_fix" | "ready_to_close" {
  if (summary?.all_done) return "ready_to_close";
  return "awaiting_fix";
}

export function columnForView(view: LiveAssetView): OpenWorkColumnId {
  const state = view.review?.state;
  if (!state) return "investigating";
  if (
    state === "opened" ||
    state === "reopened" ||
    state === "assessing"
  ) {
    return "investigating";
  }
  if (state === "pending_decision") {
    return "awaiting_decision";
  }
  if (state === "decided") {
    return followThroughColumn(view.detail?.task_summary);
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
    return "Decide PROCEED / BLOCK";
  }
  if (column === "awaiting_fix") {
    return "Wait for supervisor follow-through";
  }
  if (column === "ready_to_close") {
    return "Close review";
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
  | "awaiting_fix"
  | "ready_to_close"
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
  const column = columnForView(view);

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

  if (column === "awaiting_fix") {
    const badgeRisk: WorkBadgeRisk =
      outcome === "blocked"
        ? "blocking"
        : outcome === "approved_with_conditions"
          ? "elevated"
          : "nominal";
    const summary = view.detail?.task_summary;
    const pending = summary
      ? summary.open + summary.acknowledged
      : null;
    return {
      kind: "awaiting_fix",
      label:
        outcome === "blocked"
          ? "Awaiting fix · blocked"
          : `Awaiting fix · ${(outcome ?? "decided").replaceAll("_", " ")}`,
      badgeRisk,
      nextAction:
        pending != null && pending > 0
          ? `${pending} HITL task${pending === 1 ? "" : "s"} outstanding`
          : fallbackNextAction(column, state),
      resolved: false,
    };
  }

  if (column === "ready_to_close") {
    const badgeRisk: WorkBadgeRisk =
      outcome === "blocked"
        ? "blocking"
        : outcome === "approved_with_conditions"
          ? "elevated"
          : "nominal";
    return {
      kind: "ready_to_close",
      label:
        outcome === "blocked"
          ? "Ready to close · blocked"
          : `Ready to close · ${(outcome ?? "decided").replaceAll("_", " ")}`,
      badgeRisk,
      nextAction: "Close review",
      resolved: false,
    };
  }

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
