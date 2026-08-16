import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ResponseAction } from "./liveApi";
import {
  armProgress,
  canAbort,
  canRevoke,
  CLAUSES_FOR_ALLOWED,
  CLAUSES_FOR_REFUSED,
  equipmentBlurb,
  equipmentLabel,
  equipmentState,
  formatClock,
  groupActions,
  groupByIntent,
  headline,
  KNOWN_ACTION_KINDS,
  liveCount,
  pageStatus,
  pendingPage,
  plainState,
  secondsRemaining,
  zoneSummary,
} from "./autoResponse";

const T0 = Date.parse("2026-08-15T10:00:00.000Z");

function action(over: Partial<ResponseAction> = {}): ResponseAction {
  return {
    id: "a1",
    review_id: "r1",
    tier: 2,
    action_kind: "ventilation_on",
    label: "Ventilation started",
    status: "armed",
    device_kind: "ventilation",
    device_zone: "coke-oven-battery",
    device_state: "on",
    envelope: {
      tier: 2,
      reversible: true,
      blast_radius: "zone",
      clauses: {},
      allowed: true,
    },
    actor: "response-orchestrator",
    created_at: "2026-08-15T10:00:00.000Z",
    pages: [],
    simulated: true,
    ...over,
  } as ResponseAction;
}

describe("groupActions", () => {
  it("splits by state, not by tier", () => {
    const g = groupActions([
      action({ id: "armed", status: "armed" }),
      action({ id: "active", status: "active" }),
      action({ id: "refused", status: "refused", tier: 3 }),
    ]);
    assert.deepEqual(g.starting.map((a) => a.id), ["armed"]);
    assert.deepEqual(g.inEffect.map((a) => a.id), ["active"]);
    assert.deepEqual(g.notAutomatic.map((a) => a.id), ["refused"]);
  });

  it("drops finished actions — they belong to the audit trail", () => {
    const g = groupActions([
      action({ id: "revoked", status: "revoked" }),
      action({ id: "aborted", status: "aborted" }),
      action({ id: "superseded", status: "superseded" }),
    ]);
    assert.equal(g.starting.length + g.inEffect.length + g.notAutomatic.length, 0);
  });

  it("orders most protective first within a group", () => {
    const g = groupActions([
      action({ id: "t0", status: "active", tier: 0 }),
      action({ id: "t2", status: "active", tier: 2 }),
      action({ id: "t1", status: "active", tier: 1 }),
    ]);
    assert.deepEqual(g.inEffect.map((a) => a.id), ["t2", "t1", "t0"]);
  });
});

describe("header summary", () => {
  it("counts only what the plant is subject to", () => {
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

  it("names a single zone, so the bounded radius is visible at a glance", () => {
    assert.equal(zoneSummary([action({ status: "active" })]), "Coke Oven Battery");
  });

  it("collapses multiple zones to a count", () => {
    assert.equal(
      zoneSummary([
        action({ status: "active", device_zone: "coke-oven-battery" }),
        action({ status: "active", device_zone: "tank-farm" }),
      ]),
      "2 zones",
    );
  });

  it("returns null when nothing is engaged", () => {
    assert.equal(zoneSummary([action({ status: "refused" })]), null);
  });
});

describe("equipment naming", () => {
  it("names the equipment, not the action", () => {
    assert.equal(equipmentLabel(action()), "Ventilation");
    assert.equal(equipmentLabel(action({ device_kind: "tool_issuance_gate" })), "Tool gate");
    assert.equal(equipmentState(action()), "on");
  });

  it("names device-less actions as nouns too, so every row reads alike", () => {
    const paging = action({
      device_kind: null,
      action_kind: "page_response_team",
      label: "Response team paged",
    });
    assert.equal(equipmentLabel(paging), "Response team");
    assert.equal(equipmentState(paging), null);
  });

  it("falls back to the action label for anything unmapped", () => {
    const odd = action({
      device_kind: null,
      action_kind: "something_new",
      label: "Something new happened",
    });
    assert.equal(equipmentLabel(odd), "Something new happened");
  });
});

describe("arming window", () => {
  it("counts down whole seconds", () => {
    const a = action({ execute_after: "2026-08-15T10:00:10.000Z" });
    assert.equal(secondsRemaining(a, T0), 10);
    assert.equal(secondsRemaining(a, T0 + 4000), 6);
  });

  it("floors at zero instead of going negative", () => {
    const a = action({ execute_after: "2026-08-15T10:00:10.000Z" });
    assert.equal(secondsRemaining(a, T0 + 30_000), 0);
  });

  it("returns null when not counting down", () => {
    assert.equal(secondsRemaining(action({ status: "active" }), T0), null);
    assert.equal(secondsRemaining(action({ execute_after: null }), T0), null);
    assert.equal(secondsRemaining(action({ execute_after: "nope" }), T0), null);
  });

  it("depletes the bar from full to empty across the window", () => {
    const a = action({ execute_after: "2026-08-15T10:00:10.000Z" });
    assert.equal(armProgress(a, 10, T0), 1);
    assert.equal(armProgress(a, 10, T0 + 5000), 0.5);
    assert.equal(armProgress(a, 10, T0 + 10_000), 0);
  });

  it("never exceeds full, even if the window is misconfigured", () => {
    const a = action({ execute_after: "2026-08-15T10:00:30.000Z" });
    assert.equal(armProgress(a, 10, T0), 1);
    assert.equal(armProgress(a, 0, T0), 0);
  });
});

describe("affordances", () => {
  it("stops only while counting down, undoes only once in effect", () => {
    assert.equal(canAbort(action({ status: "armed" })), true);
    assert.equal(canAbort(action({ status: "active" })), false);
    assert.equal(canRevoke(action({ status: "active" })), true);
    assert.equal(canRevoke(action({ status: "armed" })), false);
    assert.equal(canRevoke(action({ status: "refused" })), false);
  });

  it("never offers to undo evidence preservation", () => {
    assert.equal(canRevoke(action({ tier: 0, status: "active" })), false);
    assert.equal(canAbort(action({ tier: 0, status: "armed" })), false);
  });

  it("reports an exhausted escalation chain as unanswered, never as done", () => {
    // The regression this guards: every attempt escalated, nobody acknowledged,
    // and the row rendered "done" — the worst outcome looking like success.
    const page = (over: Record<string, unknown>) => ({
      id: "p",
      action_id: "a1",
      role: "Area Supervisor",
      zone: "coke-oven-battery",
      channel: "sms",
      escalation_order: 1,
      dispatched_at: "2026-08-15T10:00:00.000Z",
      simulated: true,
      ...over,
    });
    const exhausted = action({
      device_kind: null,
      action_kind: "page_response_team",
      pages: [
        page({ id: "p1", status: "escalated" }),
        page({ id: "p2", status: "escalated", escalation_order: 2 }),
        page({ id: "p3", status: "exhausted", escalation_order: 3 }),
      ],
    } as Partial<ResponseAction>);
    const status = pageStatus(exhausted);
    assert.equal(status.kind, "unanswered");
    assert.equal(status.kind === "unanswered" && status.tried, 3);
  });

  it("prefers an acknowledgement over anything else in the chain", () => {
    const acked = action({
      device_kind: null,
      pages: [
        {
          id: "p1",
          action_id: "a1",
          role: "Area Supervisor",
          zone: "z",
          channel: "sms",
          escalation_order: 1,
          status: "escalated",
          dispatched_at: "2026-08-15T10:00:00.000Z",
          simulated: true,
        },
        {
          id: "p2",
          action_id: "a1",
          role: "Shift Fire Marshal",
          zone: "z",
          channel: "radio",
          escalation_order: 2,
          status: "acknowledged",
          dispatched_at: "2026-08-15T10:02:00.000Z",
          acknowledged_at: "2026-08-15T10:02:30.000Z",
          acknowledged_by: "M. Rao",
          simulated: true,
        },
      ],
    } as Partial<ResponseAction>);
    const status = pageStatus(acked);
    assert.equal(status.kind, "answered");
    assert.equal(status.kind === "answered" && status.by, "M. Rao");
  });

  it("reports no pages at all as none", () => {
    assert.equal(pageStatus(action()).kind, "none");
  });

  it("surfaces an outstanding page but not an answered one", () => {
    const withPending = action({
      pages: [
        {
          id: "p1",
          action_id: "a1",
          role: "Area Supervisor",
          zone: "coke-oven-battery",
          channel: "sms",
          escalation_order: 1,
          status: "dispatched",
          dispatched_at: "2026-08-15T10:00:00.000Z",
          simulated: true,
        },
      ],
    } as Partial<ResponseAction>);
    assert.equal(pendingPage(withPending)?.role, "Area Supervisor");
    assert.equal(pendingPage(action()), null);
  });
});

describe("groupByIntent", () => {
  it("names sections by what the system was trying to do", () => {
    const groups = groupByIntent([
      action({ id: "p", status: "active", tier: 2 }),
      action({ id: "w", status: "active", tier: 1 }),
      action({ id: "r", status: "active", tier: 0 }),
      action({ id: "n", status: "refused", tier: 3 }),
    ]);
    // Read together these headings are the whole explanation of the panel.
    assert.deepEqual(groups.map((g) => g.title), [
      "Made the area safer",
      "Told people",
      "Kept a record",
      "Needs a person",
    ]);
  });

  it("orders by urgency to the reader, not by tier number", () => {
    const groups = groupByIntent([
      action({ id: "r", status: "active", tier: 0 }),
      action({ id: "p", status: "active", tier: 2 }),
    ]);
    assert.deepEqual(groups.map((g) => g.tier), [2, 0]);
  });

  it("omits empty sections rather than showing a heading with nothing under it", () => {
    const groups = groupByIntent([action({ status: "active", tier: 2 })]);
    assert.equal(groups.length, 1);
  });

  it("keeps armed actions in their intent section so the why stays visible", () => {
    const groups = groupByIntent([action({ status: "armed", tier: 2 })]);
    assert.equal(groups[0].title, "Made the area safer");
    assert.equal(groups[0].actions[0].status, "armed");
  });

  it("drops finished actions", () => {
    assert.equal(groupByIntent([action({ status: "revoked" })]).length, 0);
  });
});

describe("plain language", () => {
  it("turns device values into words you can picture", () => {
    assert.equal(plainState("on"), "running");
    assert.equal(plainState("closed"), "locked");
    assert.equal(plainState("announcing"), "playing");
    assert.equal(plainState(null), null);
  });

  it("passes through anything it does not have a word for", () => {
    assert.equal(plainState("purging"), "purging");
  });
});

describe("headline", () => {
  it("says how many and where, with no prose to read", () => {
    const h = headline([action({ status: "active" })], "Vessel A");
    assert.equal(h.count, 1);
    assert.equal(h.where, "Vessel A · Coke Oven Battery");
  });

  it("falls back to the zone when the asset is unknown", () => {
    assert.equal(headline([action({ status: "active" })], null).where, "Coke Oven Battery");
  });
});

describe("formatClock", () => {
  it("renders mm:ss", () => {
    assert.equal(formatClock(7), "0:07");
    assert.equal(formatClock(72), "1:12");
    assert.equal(formatClock(600), "10:00");
  });
});

describe("equipmentBlurb", () => {
  /**
   * Every action kind the backend envelope registry can produce. Mirrors
   * ACTION_SPECS in backend/app/response/envelope.py:89-199 — if a kind is added
   * there without a blurb here, a judge meets a named piece of plant equipment
   * with nothing saying what it is, which is the defect this map exists to fix.
   */
  const BACKEND_ACTION_KINDS = [
    "preserve_evidence",
    "pa_announcement",
    "exclusion_signage",
    "page_response_team",
    "ventilation_on",
    "tool_issuance_gate_closed",
    "permit_freeze",
    "muster_alarm",
    "unit_shutdown",
    "depressurize",
    "evacuation_complete",
  ];

  it("explains every action kind the backend can produce", () => {
    for (const kind of BACKEND_ACTION_KINDS) {
      const blurb = equipmentBlurb(action({ action_kind: kind }));
      assert.ok(blurb, `no blurb for ${kind}`);
      assert.ok(
        (blurb as string).length > 20,
        `blurb for ${kind} is too short to explain anything`,
      );
    }
  });

  it("has no blurb for a kind the backend cannot produce", () => {
    assert.deepEqual(
      KNOWN_ACTION_KINDS.filter((k) => !BACKEND_ACTION_KINDS.includes(k)),
      [],
    );
  });

  it("returns null rather than throwing on an unknown kind", () => {
    assert.equal(equipmentBlurb(action({ action_kind: "teleport" })), null);
  });
});

describe("clause sets", () => {
  it("hides the tier clause on an action that ran, because it is circular", () => {
    assert.ok(
      !CLAUSES_FOR_ALLOWED.some((c) => c.key === "tier_permits_automation"),
    );
    assert.equal(CLAUSES_FOR_ALLOWED.length, 3);
  });

  it("keeps the tier clause on a refusal, where it is the whole reason", () => {
    assert.ok(
      CLAUSES_FOR_REFUSED.some((c) => c.key === "tier_permits_automation"),
    );
  });
});

describe("groupByIntent · refusals", () => {
  it("keeps tier 3 refusals, which are the point of that section", () => {
    const groups = groupByIntent([action({ status: "refused", tier: 3 })]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "Needs a person");
  });

  /**
   * The master switch being off refuses tier 1/2 actions. Those were landing in
   * "Made the area safer" carrying a state word, so a paused system read as
   * though it had acted.
   */
  it("drops a lower-tier refusal so a paused system does not look active", () => {
    assert.equal(groupByIntent([action({ status: "refused", tier: 2 })]).length, 0);
    assert.equal(groupByIntent([action({ status: "refused", tier: 1 })]).length, 0);
  });
});
