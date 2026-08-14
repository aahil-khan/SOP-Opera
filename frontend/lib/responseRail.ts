/**
 * Pure presentation logic for the response rail.
 *
 * Kept out of the component so the abort-window countdown and the ordering can
 * be tested without a browser — the countdown is the one piece of W1 the
 * supervisor reacts to under time pressure, so it should not be verified only
 * by looking at it.
 */

import type { ResponseAction } from "@/lib/liveApi";

export type RailPhase =
  | "arming"
  | "active"
  | "refused"
  | "revoked"
  | "aborted";

export function railPhase(action: ResponseAction): RailPhase {
  switch (action.status) {
    case "armed":
      return "arming";
    case "active":
      return "active";
    case "refused":
      return "refused";
    case "revoked":
      return "revoked";
    default:
      return "aborted";
  }
}

/**
 * Whole seconds left in the arming window, floored at zero.
 *
 * Returns null when the action is not counting down, so the caller can render
 * nothing rather than a misleading "0s".
 */
export function secondsRemaining(
  action: ResponseAction,
  now: number = Date.now(),
): number | null {
  if (action.status !== "armed" || !action.execute_after) return null;
  const target = Date.parse(action.execute_after);
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/** An armed action can still be stopped; an executed one must be revoked. */
export function canAbort(action: ResponseAction): boolean {
  return action.status === "armed";
}

export function canRevoke(action: ResponseAction): boolean {
  return action.status === "armed" || action.status === "active";
}

const TIER_LABEL: Record<number, string> = {
  0: "Preserve",
  1: "Warn",
  2: "Protect",
  3: "Never automatic",
};

export function tierLabel(tier: number): string {
  return TIER_LABEL[tier] ?? `Tier ${tier}`;
}

/**
 * Operator-facing wording. W12 renames internal vocabulary: a safety officer
 * does not say "tier 2 actuator command".
 */
export function phaseLabel(action: ResponseAction, now?: number): string {
  const phase = railPhase(action);
  if (phase === "arming") {
    const secs = secondsRemaining(action, now);
    return secs === null ? "Starting" : `Starting in ${secs}s`;
  }
  if (phase === "active") return "In effect";
  if (phase === "refused") return "Not automatic";
  if (phase === "revoked") return "Undone";
  return "Stopped";
}

/**
 * Rail order: what needs attention first.
 *
 * Counting-down actions lead because they are the only ones with a deadline.
 * Then live actions, then refusals, which are context rather than events.
 */
const PHASE_RANK: Record<RailPhase, number> = {
  arming: 0,
  active: 1,
  refused: 2,
  revoked: 3,
  aborted: 4,
};

export function sortForRail(actions: ResponseAction[]): ResponseAction[] {
  return [...actions].sort((a, b) => {
    const byPhase = PHASE_RANK[railPhase(a)] - PHASE_RANK[railPhase(b)];
    if (byPhase !== 0) return byPhase;
    if (a.tier !== b.tier) return b.tier - a.tier;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

/** Rail header count — actions the plant is currently subject to. */
export function liveCount(actions: ResponseAction[]): number {
  return actions.filter(
    (a) => a.status === "armed" || a.status === "active",
  ).length;
}

/**
 * The clause that permitted (or blocked) an action, in operator language.
 * Order matches the gate's evaluation order in response/envelope.py.
 */
export const CLAUSE_LABELS: Array<{ key: string; label: string }> = [
  { key: "tier_permits_automation", label: "Tier allows automation" },
  { key: "reversible", label: "Can be undone" },
  { key: "fail_safe_direction", label: "Moves toward safety" },
  { key: "bounded_blast_radius", label: "Limited to this area" },
];
