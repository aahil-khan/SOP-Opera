import assert from "node:assert/strict";
import test from "node:test";
import {
  columnForReviewState,
  columnForView,
  fallbackNextAction,
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
): TestView {
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
    detail:
      taskSummary === undefined
        ? null
        : ({
            review: {} as never,
            asset: {} as never,
            context: [],
            derived_facts: [],
            decision: null,
            task_summary: taskSummary,
          } as TestView["detail"]),
    assessment: null,
    risk_level: "nominal",
    sensor_critical: false,
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
