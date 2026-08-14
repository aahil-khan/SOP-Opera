import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ResponseAction } from "./liveApi";
import {
  canAbort,
  canRevoke,
  liveCount,
  phaseLabel,
  railPhase,
  secondsRemaining,
  sortForRail,
} from "./responseRail";

const T0 = Date.parse("2026-08-14T10:00:00.000Z");

function action(over: Partial<ResponseAction> = {}): ResponseAction {
  return {
    id: "a1",
    review_id: "r1",
    tier: 2,
    action_kind: "ventilation_on",
    label: "Ventilation started",
    status: "armed",
    envelope: {
      tier: 2,
      reversible: true,
      blast_radius: "zone",
      clauses: {},
      allowed: true,
    },
    actor: "response-orchestrator",
    created_at: "2026-08-14T10:00:00.000Z",
    pages: [],
    simulated: true,
    ...over,
  } as ResponseAction;
}

describe("secondsRemaining", () => {
  it("counts down the arming window", () => {
    const a = action({ execute_after: "2026-08-14T10:00:10.000Z" });
    assert.equal(secondsRemaining(a, T0), 10);
    assert.equal(secondsRemaining(a, T0 + 4000), 6);
  });

  it("floors at zero rather than going negative", () => {
    const a = action({ execute_after: "2026-08-14T10:00:10.000Z" });
    assert.equal(secondsRemaining(a, T0 + 30_000), 0);
  });

  it("returns null when the action is not counting down", () => {
    assert.equal(secondsRemaining(action({ status: "active" }), T0), null);
    assert.equal(secondsRemaining(action({ execute_after: null }), T0), null);
    assert.equal(
      secondsRemaining(action({ execute_after: "not a date" }), T0),
      null,
    );
  });
});

describe("phase", () => {
  it("maps status onto operator language, not internal vocabulary", () => {
    assert.equal(
      phaseLabel(action({ execute_after: "2026-08-14T10:00:07.000Z" }), T0),
      "Starting in 7s",
    );
    assert.equal(phaseLabel(action({ status: "active" })), "In effect");
    assert.equal(phaseLabel(action({ status: "refused" })), "Not automatic");
    assert.equal(phaseLabel(action({ status: "revoked" })), "Undone");
  });

  it("classifies every status", () => {
    assert.equal(railPhase(action({ status: "armed" })), "arming");
    assert.equal(railPhase(action({ status: "active" })), "active");
    assert.equal(railPhase(action({ status: "refused" })), "refused");
    assert.equal(railPhase(action({ status: "revoked" })), "revoked");
    assert.equal(railPhase(action({ status: "aborted" })), "aborted");
  });
});

describe("affordances", () => {
  it("allows abort only while still counting down", () => {
    assert.equal(canAbort(action({ status: "armed" })), true);
    assert.equal(canAbort(action({ status: "active" })), false);
    assert.equal(canAbort(action({ status: "refused" })), false);
  });

  it("allows revoke while armed or in effect, never once ended", () => {
    assert.equal(canRevoke(action({ status: "armed" })), true);
    assert.equal(canRevoke(action({ status: "active" })), true);
    assert.equal(canRevoke(action({ status: "revoked" })), false);
    assert.equal(canRevoke(action({ status: "refused" })), false);
  });

  it("never offers to undo evidence preservation", () => {
    // Tier 0 drives no equipment. An "undo" there would do nothing and would
    // imply the record can be withdrawn.
    const tier0 = action({ tier: 0, status: "active", action_kind: "preserve_evidence" });
    assert.equal(canRevoke(tier0), false);
    assert.equal(canAbort(action({ tier: 0, status: "armed" })), false);
  });
});

describe("sortForRail", () => {
  it("puts counting-down actions first — they are the ones with a deadline", () => {
    const rows = sortForRail([
      action({ id: "refused", status: "refused", tier: 3 }),
      action({ id: "active", status: "active" }),
      action({ id: "armed", status: "armed" }),
    ]);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["armed", "active", "refused"],
    );
  });

  it("orders equal phases by tier, most protective first", () => {
    const rows = sortForRail([
      action({ id: "t1", status: "active", tier: 1 }),
      action({ id: "t2", status: "active", tier: 2 }),
    ]);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["t2", "t1"],
    );
  });
});

describe("liveCount", () => {
  it("counts only what the plant is actually subject to", () => {
    assert.equal(
      liveCount([
        action({ status: "armed" }),
        action({ status: "active" }),
        action({ status: "refused" }),
        action({ status: "revoked" }),
      ]),
      2,
    );
  });
});
