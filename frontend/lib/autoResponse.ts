/**
 * Presentation logic for the Auto response sidebar.
 *
 * Pure and side-effect free so the two things an operator reads under pressure —
 * the arming countdown and which group an action falls into — are testable
 * without a browser.
 *
 * The panel is organised by *state*, not by tier, because that is how an
 * operator triages: what has a deadline, what is true of the plant right now,
 * and what the system declined to do. Tier survives only as a colour edge.
 */

import type { ResponseAction } from "@/lib/liveApi";

export interface ActionGroups {
  /** Counting down — the only rows with a deadline. */
  starting: ResponseAction[];
  /** Currently true of the plant. */
  inEffect: ResponseAction[];
  /** Considered and declined. Context, not clutter. */
  notAutomatic: ResponseAction[];
}

export function groupActions(actions: ResponseAction[]): ActionGroups {
  const starting: ResponseAction[] = [];
  const inEffect: ResponseAction[] = [];
  const notAutomatic: ResponseAction[] = [];

  for (const a of actions) {
    if (a.status === "armed") starting.push(a);
    else if (a.status === "active") inEffect.push(a);
    else if (a.status === "refused") notAutomatic.push(a);
    // aborted / revoked / superseded are finished: they belong to the audit
    // trail and the report, not to a panel about the plant's current state.
  }

  // Most protective first inside each group.
  const byTier = (x: ResponseAction, y: ResponseAction) => y.tier - x.tier;
  starting.sort(byTier);
  inEffect.sort(byTier);
  notAutomatic.sort(byTier);

  return { starting, inEffect, notAutomatic };
}

/** Actions the plant is currently subject to — the header count. */
export function liveCount(actions: ResponseAction[]): number {
  return actions.filter(
    (a) => a.status === "armed" || a.status === "active",
  ).length;
}

/**
 * Zones the response is touching, for the header line.
 *
 * This is the bounded-blast-radius claim made visible: an operator should be
 * able to see at a glance that the system is acting on one area, not the plant.
 */
export function zoneSummary(actions: ResponseAction[]): string | null {
  const zones = new Set<string>();
  for (const a of actions) {
    if (
      (a.status === "armed" || a.status === "active") &&
      a.device_zone
    ) {
      zones.add(a.device_zone);
    }
  }
  if (zones.size === 0) return null;
  if (zones.size === 1) return [...zones][0];
  return `${zones.size} zones`;
}

// --- Intent grouping ---------------------------------------------------------

/**
 * Sections named by what the system was *trying to do*, not by our internal
 * state or tier number.
 *
 * The first version of this panel grouped by status ("In effect", "Not
 * automatic") and was unreadable to anyone seeing it for the first time: eight
 * equipment states with no cause and no purpose. Tier already encodes intent —
 * protect, warn, preserve, never — so saying it in plain words costs nothing
 * and is the difference between a list and an explanation.
 */
export interface IntentGroup {
  id: string;
  title: string;
  /** One line telling a first-time reader what this section is for. */
  hint: string;
  tier: number;
  actions: ResponseAction[];
}

const INTENT_BY_TIER: Record<number, { id: string; title: string; hint: string }> = {
  2: {
    id: "protect",
    title: "Made the area safe",
    hint: "Equipment the system changed to reduce the hazard.",
  },
  1: {
    id: "warn",
    title: "Warned people",
    hint: "Alerts raised so anyone nearby knows.",
  },
  0: {
    id: "record",
    title: "Kept a record",
    hint: "Evidence captured so the decision can be reviewed later.",
  },
  3: {
    id: "never",
    title: "Will never do on its own",
    hint: "These always need a person to start them.",
  },
};

/** Order sections by urgency to the reader, not by tier number. */
const INTENT_ORDER = [2, 1, 0, 3];

export function groupByIntent(actions: ResponseAction[]): IntentGroup[] {
  const live = actions.filter(
    (a) =>
      a.status === "armed" || a.status === "active" || a.status === "refused",
  );

  return INTENT_ORDER.map((tier) => {
    const meta = INTENT_BY_TIER[tier];
    return {
      id: meta.id,
      title: meta.title,
      hint: meta.hint,
      tier,
      actions: live.filter((a) => a.tier === tier),
    };
  }).filter((g) => g.actions.length > 0);
}

/**
 * The one line at the top of the panel.
 *
 * Deliberately not prose. This is a showcase surface that has to be understood
 * by scanning, and the section headings above already tell the story — "made
 * the area safe / warned people / kept a record / never without a person" reads
 * as a sentence on its own. Adding a paragraph on top would be a second thing
 * to read, competing with the thing that already works.
 */
export function headline(
  actions: ResponseAction[],
  assetName: string | null,
): { count: number; where: string | null } {
  const count = liveCount(actions);
  const zone = zoneSummary(actions);
  const where = assetName
    ? zone
      ? `${assetName} · ${zone}`
      : assetName
    : zone;
  return { count, where };
}

// --- Equipment naming --------------------------------------------------------

/**
 * Operators read equipment, not action names: "Ventilation · on" lands faster
 * than "Ventilation started". W12 asks for operator language over ours.
 */
const EQUIPMENT_NOUN: Record<string, string> = {
  ventilation: "Ventilation",
  pa_zone: "Public address",
  exclusion_signage: "Exclusion signs",
  tool_issuance_gate: "Tool gate",
  muster_alarm: "Muster alarm",
  permit_gate: "Permit",
};

/**
 * Device states in words someone reads rather than decodes. "on" is a value in
 * a column; "running" is a fan you can picture.
 */
const PLAIN_STATE: Record<string, string> = {
  on: "running",
  off: "stopped",
  closed: "locked",
  open: "open",
  lit: "lit",
  clear: "clear",
  announcing: "playing",
  idle: "quiet",
  sounding: "sounding",
  silent: "silent",
  frozen: "frozen",
};

export function plainState(state: string | null): string | null {
  if (!state) return null;
  return PLAIN_STATE[state] ?? state;
}

/**
 * Device-less actions, named as nouns like everything else so every row in the
 * panel reads the same way: a thing, then its state.
 */
const ACTION_NOUN: Record<string, string> = {
  page_response_team: "Response team",
  preserve_evidence: "Evidence",
};

export function equipmentLabel(action: ResponseAction): string {
  if (action.device_kind && EQUIPMENT_NOUN[action.device_kind]) {
    return EQUIPMENT_NOUN[action.device_kind];
  }
  return ACTION_NOUN[action.action_kind] ?? action.label;
}

/** The state word shown beside the equipment, or null when there is no device. */
export function equipmentState(action: ResponseAction): string | null {
  if (!action.device_kind) return null;
  return (
    action.device_state ?? action.envelope?.commanded_state ?? null
  );
}

// --- Arming window -----------------------------------------------------------

/** Whole seconds left before an armed action fires, or null if not counting. */
export function secondsRemaining(
  action: ResponseAction,
  now: number = Date.now(),
): number | null {
  if (action.status !== "armed" || !action.execute_after) return null;
  const target = Date.parse(action.execute_after);
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/**
 * Fraction of the arming window still remaining, 0..1.
 *
 * Drives the depleting bar behind a starting row — the row *is* the timer, which
 * is the one place this panel spends any motion.
 */
export function armProgress(
  action: ResponseAction,
  windowSeconds: number,
  now: number = Date.now(),
): number {
  const secs = secondsRemaining(action, now);
  if (secs === null) return 0;
  if (windowSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, secs / windowSeconds));
}

// --- Affordances -------------------------------------------------------------

/** An armed action can still be stopped before it happens. */
export function canAbort(action: ResponseAction): boolean {
  return action.status === "armed" && action.tier > 0;
}

/**
 * Tier 0 is excluded deliberately. Preserving evidence drives no equipment, so
 * there is nothing to undo, and the control would imply the record can be
 * withdrawn — the opposite of what an evidence snapshot is for.
 */
export function canRevoke(action: ResponseAction): boolean {
  if (action.tier === 0) return false;
  return action.status === "active";
}

/** Outstanding page on this action, if any — drives the acknowledge affordance. */
export function pendingPage(action: ResponseAction) {
  return action.pages.find((p) => p.status === "dispatched") ?? null;
}

export function acknowledgedPage(action: ResponseAction) {
  return action.pages.find((p) => p.acknowledged_at) ?? null;
}

export type PageStatus =
  | { kind: "none" }
  | { kind: "answered"; role: string; by: string | null }
  | { kind: "waiting"; pageId: string; role: string; channel: string; since: string }
  | { kind: "unanswered"; tried: number };

/**
 * What actually happened to the call-out.
 *
 * `unanswered` matters most: when the escalation chain runs out with nobody
 * acknowledging, that is the worst outcome this feature can produce, and it
 * previously rendered as "done" — indistinguishable from success. A page nobody
 * answered has to read as a failure, because someone now has to go and look.
 */
export function pageStatus(action: ResponseAction): PageStatus {
  if (action.pages.length === 0) return { kind: "none" };

  const answered = acknowledgedPage(action);
  if (answered) {
    return {
      kind: "answered",
      role: answered.role,
      by: answered.acknowledged_by ?? null,
    };
  }

  const waiting = pendingPage(action);
  if (waiting) {
    return {
      kind: "waiting",
      pageId: waiting.id,
      role: waiting.role,
      channel: waiting.channel,
      since: waiting.dispatched_at,
    };
  }

  // Every attempt escalated or ran out, and none was acknowledged.
  return { kind: "unanswered", tried: action.pages.length };
}

/** Seconds since a page went out, for "no reply" timing. */
export function secondsSinceDispatch(
  dispatchedAt: string,
  now: number = Date.now(),
): number | null {
  const t = Date.parse(dispatchedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 1000));
}

/**
 * The envelope's four clauses in operator language, in the order the backend
 * gate evaluates them (`response/envelope.py`) — so the first failing clause in
 * this list is the one that decided a refusal.
 */
export const CLAUSE_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "tier_permits_automation", label: "Tier allows automation" },
  { key: "reversible", label: "Can be undone" },
  { key: "fail_safe_direction", label: "Moves toward safety" },
  { key: "bounded_blast_radius", label: "Limited to this area" },
];

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
