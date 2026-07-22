import assert from "node:assert/strict";
import test from "node:test";
import {
  columnForReviewState,
  columnForView,
  fallbackNextAction,
  isBlockedWork,
  lifecycleLabelForReviewState,
} from "./openWork";

type TestView = Parameters<typeof columnForView>[0];

function view(
  state: "decided" | "pending_decision" | "assessing" | "closed",
  taskSummary?: {
    total: number;
    open: number;
    acknowledged: number;
    done: number;
    cancelled: number;
    all_done: boolean;
  } | null,
  extras?: {
    decisionOutcome?: "approved" | "approved_with_conditions" | "blocked" | null;
    assessmentRisk?: "nominal" | "elevated" | "blocking";
    assessmentSummary?: string;
    mapCleared?: boolean;
  },
): TestView {
  const decision =
    extras?.decisionOutcome === undefined
      ? null
      : extras.decisionOutcome == null
        ? null
        : ({
            id: "d1",
            review_id: "r1",
            outcome: extras.decisionOutcome,
            rationale: "",
            conditions: null,
            decided_by: "u1",
            created_at: "2026-01-01T00:00:00Z",
          } as NonNullable<NonNullable<TestView["detail"]>["decision"]>);

  const wantsDetail =
    taskSummary !== undefined || extras?.decisionOutcome !== undefined;

  return {
    asset: { id: "a1", name: "Vessel A", zone: "z", plant_id: "p", floor: "ground" },
    review: {
      id: "r1",
      asset_id: "a1",
      state,
      owner_id: "u1",
      triggered_by: "test",
      origin: "system",
      raised_by_worker_id: null,
      created_at: "2026-01-01T00:00:00Z",
    },
    detail: !wantsDetail
      ? null
      : ({
          review: {} as never,
          asset: {} as never,
          context: [],
          derived_facts: [],
          decision,
          task_summary: taskSummary ?? null,
        } as TestView["detail"]),
    assessment:
      extras?.assessmentRisk || extras?.assessmentSummary
        ? ({
            id: "as1",
            review_id: "r1",
            risk_level: extras.assessmentRisk ?? "nominal",
            summary: extras.assessmentSummary ?? "",
            recommendations: [],
            evidence_refs: [],
            model_meta: {},
            created_at: "2026-01-01T00:00:00Z",
          } as NonNullable<TestView["assessment"]>)
        : null,
    risk_level: extras?.assessmentRisk ?? "nominal",
    sensor_critical: false,
    map_cleared: extras?.mapCleared ?? false,
  };
}

test("columnForReviewState maps pre-decision states", () => {
  assert.equal(columnForReviewState("assessing"), "investigating");
  assert.equal(columnForReviewState("pending_decision"), "awaiting_decision");
  assert.equal(columnForReviewState("decided"), "awaiting_fix");
  assert.equal(columnForReviewState("closed"), "closed");
});

test("columnForView splits decided by task_summary", () => {
  assert.equal(
    columnForView(
      view("decided", {
        total: 1,
        open: 1,
        acknowledged: 0,
        done: 0,
        cancelled: 0,
        all_done: false,
      }),
    ),
    "awaiting_fix",
  );
  assert.equal(
    columnForView(
      view("decided", {
        total: 1,
        open: 0,
        acknowledged: 0,
        done: 1,
        cancelled: 0,
        all_done: true,
      }),
    ),
    "ready_to_close",
  );
  assert.equal(
    columnForView(
      view("decided", {
        total: 0,
        open: 0,
        acknowledged: 0,
        done: 0,
        cancelled: 0,
        all_done: true,
      }),
    ),
    "ready_to_close",
  );
});

test("fallbackNextAction for follow-through columns", () => {
  assert.equal(fallbackNextAction("awaiting_fix"), "Wait for supervisor follow-through");
  assert.equal(fallbackNextAction("ready_to_close"), "Close review");
});

test("lifecycleLabelForReviewState uses board labels", () => {
  assert.equal(lifecycleLabelForReviewState("assessing"), "Investigating");
  assert.equal(lifecycleLabelForReviewState("pending_decision"), "Awaiting decision");
  assert.equal(lifecycleLabelForReviewState("decided"), "Awaiting fix");
  assert.equal(lifecycleLabelForReviewState("closed"), "Closed");
});

test("isBlockedWork counts active supervisor blocks only", () => {
  assert.equal(
    isBlockedWork(view("decided", null, { decisionOutcome: "blocked" })),
    true,
  );
  assert.equal(
    isBlockedWork(view("closed", null, { decisionOutcome: "blocked" })),
    true,
  );
  assert.equal(
    isBlockedWork(
      view("closed", null, { decisionOutcome: "blocked", mapCleared: true }),
    ),
    false,
  );
  assert.equal(
    isBlockedWork(view("closed", null, { decisionOutcome: "approved" })),
    false,
  );
  assert.equal(
    isBlockedWork(
      view("pending_decision", null, {
        assessmentRisk: "blocking",
        assessmentSummary: "Recommend BLOCK — compound pathway",
      }),
    ),
    false,
  );
});
