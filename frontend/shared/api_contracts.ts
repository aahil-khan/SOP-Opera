/**
 * REST + WebSocket contract surface (TDS §8).
 * Phase 0 freezes this list; later phases implement routes behind these shapes.
 */

export const REST_GROUPS = {
  reviews: [
    "POST /reviews",
    "GET /reviews",
    "GET /reviews/{id}",
    "POST /reviews/{id}/escalate",
    "POST /reviews/{id}/reopen",
  ],
  context: ["POST /context", "GET /assets", "GET /assets/{id}/context", "GET /assets/{id}/owner"],
  assessments: [
    "GET /reviews/{id}/assessments",
    "POST /reviews/{id}/assessments/retry",
    "POST /reviews/{id}/assessments/manual",
  ],
  decisions: ["POST /reviews/{id}/decisions"],
  reports: ["GET /reviews/{id}/reports", "GET /reports/{id}"],
  notifications: ["GET /notifications"],
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
