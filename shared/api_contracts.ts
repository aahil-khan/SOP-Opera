/**
 * REST + WebSocket contract surface (TDS §8).
 * Phase 0 freezes this list; later phases implement routes behind these shapes.
 */

export const REST_GROUPS = {
  reviews: [
    "POST /reviews",
    "GET /reviews",
    "GET /reviews/{id}",
    "GET /reviews/raised-by-me",
    "GET /reviews/shared-with-me",
    "GET /reviews/in-my-zones",
    "POST /reviews/{id}/reopen",
    "POST /reviews/{id}/close",
    "GET /reviews/{id}/comments",
    "POST /reviews/{id}/comments",
  ],
  context: ["POST /context", "GET /assets", "GET /assets/{id}/context", "GET /assets/{id}/owner"],
  assessments: [
    "GET /reviews/{id}/assessments",
    "POST /reviews/{id}/assessments/retry",
    "POST /reviews/{id}/assessments/manual",
  ],
  decisions: ["POST /reviews/{id}/decisions"],
  tasks: [
    "GET /tasks",
    "POST /tasks/{id}/acknowledge",
    "POST /tasks/{id}/done",
  ],
  reports: ["GET /reviews/{id}/reports", "GET /reports/{id}"],
  notifications: ["GET /notifications"],
  handover: [
    "GET /handover/current",
    "GET /handover/gaps",
    "GET /handover/metrics",
    "POST /handover/draft",
    "POST /handover/{id}/notes",
    "DELETE /handover/{id}/items/{itemId}",
    "POST /handover/{id}/issue",
    "POST /handover/{id}/items/{itemId}/ack",
    "POST /handover/{id}/accept",
  ],
  aiOps: ["GET /ai-ops/summary"],
  demo: [
    "POST /demo/scenarios/{name}/start",
    "POST /demo/reset",
    "GET /demo/scenarios",
  ],
  /** Phase 0 scaffolding only */
  health: ["GET /health", "GET /api/ping"],
} as const;

export const WS_EVENTS = [
  "review.status_changed",
  "assessment.completed",
  "assessment.failed",
  "decision.submitted",
  "report.generated",
  "comment.created",
  "task.created",
  "task.acknowledged",
  "task.completed",
  "task.cancelled",
  "notification.created",
  "handover.issued",
  "handover.item_acknowledged",
  "handover.accepted",
  "echo",
] as const;

export type WsEventType = (typeof WS_EVENTS)[number];

export interface WsEnvelope<T = unknown> {
  type: WsEventType | string;
  payload: T;
  ts: string;
}

export interface PingResponse {
  ok: true;
  service: "sop-opera-api";
  message: string;
}
