import type { Notification } from "@/shared/schemas";

export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationPresentation {
  /** Short label shown in the activity inbox badge. */
  label: string;
  /** Primary title for toast + inbox row. */
  title: string;
  /** Supporting detail (usually the backend summary). */
  detail: string;
  severity: NotificationSeverity;
  /** Whether a live toast should interrupt the user. */
  toastable: boolean;
}

function riskFromSummary(
  summary: string,
): "critical" | "blocking" | "elevated" | null {
  if (/\bcritical\b/i.test(summary)) return "critical";
  if (/\bblocking\b/i.test(summary)) return "blocking";
  if (/\belevated\b/i.test(summary)) return "elevated";
  return null;
}

/** Stable toast id so events for the same review replace instead of stacking. */
export function notificationToastId(n: Notification): string {
  return n.review_id ? `review-${n.review_id}` : n.id;
}

/**
 * Blocking (critical) and failed assessments only — elevated / routine stay quiet.
 */
export function isAlertNotification(n: Notification): boolean {
  return presentNotification(n).severity === "error";
}

/**
 * Maps machine event_type (+ summary hints) to human-facing copy.
 * Never expose raw event_type strings in the UI.
 */
export function presentNotification(n: Notification): NotificationPresentation {
  switch (n.event_type) {
    case "review.opened":
      return {
        label: "New review",
        title: "New review",
        detail: n.summary,
        severity: "info",
        toastable: false,
      };
    case "assessment.completed": {
      const risk = riskFromSummary(n.summary);
      if (risk === "critical") {
        return {
          label: "Critical",
          title: "Critical risk",
          detail: n.summary,
          severity: "error",
          toastable: true,
        };
      }
      if (risk === "blocking") {
        return {
          label: "Blocking risk",
          title: "Blocking risk",
          detail: n.summary,
          severity: "error",
          toastable: true,
        };
      }
      return {
        label: "Elevated risk",
        title: "Elevated risk",
        detail: n.summary,
        severity: "warning",
        toastable: false,
      };
    }
    case "assessment.failed":
      return {
        label: "Assessment failed",
        title: "Assessment failed",
        detail: n.summary,
        severity: "error",
        toastable: true,
      };
    case "decision.submitted":
      return {
        label: "Decision recorded",
        title: "Decision recorded",
        detail: n.summary,
        severity: "info",
        toastable: false,
      };
    case "review.closed":
      return {
        label: "Review closed",
        title: "Review closed",
        detail: n.summary,
        severity: "info",
        toastable: false,
      };
    case "review.escalated":
      return {
        label: "Escalated",
        title: "Situation escalated",
        detail: n.summary,
        severity: "error",
        toastable: /\bprior decision\b/i.test(n.summary),
      };
    case "review.de_escalated":
      return {
        label: "De-escalated",
        title: "Escalation resolved",
        detail: n.summary,
        severity: "info",
        toastable: false,
      };
    case "supervisor_report.tagged":
      return {
        label: "Shared issue",
        title: "Floor issue shared with you",
        detail: n.summary,
        severity: "info",
        toastable: false,
      };
    default:
      return {
        label: "Update",
        title: "Update",
        detail: n.summary,
        severity: "info",
        toastable: false,
      };
  }
}
