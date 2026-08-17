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
import { zoneLabel } from "@/lib/zoneLabel";

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
  // Slugs are a storage detail — `coke-oven-battery` is not a place name.
  if (zones.size === 1) return zoneLabel([...zones][0]);
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
    title: "Made the area safer",
    hint: "Equipment the system changed to cut the hazard.",
  },
  1: {
    id: "warn",
    title: "Told people",
    hint: "Alerts raised so anyone nearby knows.",
  },
  0: {
    id: "record",
    title: "Kept a record",
    hint: "Evidence frozen so the decision can be audited later.",
  },
  3: {
    id: "never",
    /**
     * Named for who has to act, not for what the system lacks. "Will never do
     * on its own" describes our restraint in our own terms; a reader meeting
     * the panel for the first time needs to know a supervisor is the one who
     * starts these.
     */
    title: "Needs a person",
    hint: "These can't be undone, so the system stops here and waits for a supervisor.",
  },
};

/** Order sections by urgency to the reader, not by tier number. */
const INTENT_ORDER = [2, 1, 0, 3];

export function groupByIntent(actions: ResponseAction[]): IntentGroup[] {
  const live = actions.filter((a) => {
    if (a.status === "armed" || a.status === "active") return true;
    /**
     * Refusals belong in "Needs a person", not in the sections describing what
     * the system actually did. A Tier 1/2 action can also be refused — the
     * master switch being off is the common case — and those were landing under
     * "Made the area safer" carrying a state word, so a paused system read as
     * though it had acted. Tier 3 refusals are the point of that section and
     * stay.
     */
    return a.status === "refused" && a.tier === 3;
  });

  return INTENT_ORDER.map((tier) => {
    const meta = INTENT_BY_TIER[tier];
    return {
      id: meta.id,
      title: meta.title,
      hint: meta.hint,
      tier,
      // Stable order within a group. Without an explicit sort the rows inherit
      // whatever order the server returned, so a refetch or a live update
      // reshuffles the list under the reader's cursor mid-demo.
      actions: live
        .filter((a) => a.tier === tier)
        .sort(
          (x, y) =>
            x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id),
        ),
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

/*
 * A header line asserting "every one can be undone · N refused" used to live
 * here. It was cut: the reversibility claim now sits where it is actually
 * useful — per action, in the expanded row ("Can be switched back") — and the
 * refusal count is the "Needs a person" section's own heading. Stating both
 * again at the top pushed the list itself below the fold.
 */

// --- Equipment naming --------------------------------------------------------

/**
 * Operators read equipment, not action names: "Ventilation · on" lands faster
 * than "Ventilation started". W12 asks for operator language over ours.
 *
 * The one source of device names. There were three — this map, `SHORT` in
 * DeviceChips and `RESPONSE_DEVICE_SHORT` in DigitalTwin — so the same device
 * was "Public address" in the panel and "PA" on the map. Both now import from
 * here; `deviceShortLabel` is the abbreviated form for the map badges and chips
 * where horizontal space is genuinely tight.
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
 * The same equipment, abbreviated for map badges and device chips where a full
 * name will not fit.
 *
 * There were three of these maps — this one, `SHORT` in DeviceChips and
 * `RESPONSE_DEVICE_SHORT` in DigitalTwin — and they disagreed: `pa_zone` read
 * "Public address" in the panel and "PA" on the map, ventilation was
 * "Ventilation" twice and "Vent" once. One vocabulary, one place.
 */
const EQUIPMENT_SHORT: Record<string, string> = {
  ventilation: "Ventilation",
  pa_zone: "PA",
  exclusion_signage: "Signage",
  tool_issuance_gate: "Tool gate",
  muster_alarm: "Muster",
  permit_gate: "Permit",
};

/** Full device name, e.g. "Public address". */
export function deviceLabel(kind: string): string {
  return EQUIPMENT_NOUN[kind] ?? kind;
}

/** Abbreviated device name for chips and map badges, e.g. "PA". */
export function deviceShortLabel(kind: string): string {
  return EQUIPMENT_SHORT[kind] ?? EQUIPMENT_NOUN[kind] ?? kind;
}

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

/**
 * What each piece of equipment physically is, in one sentence.
 *
 * The panel named things ("Muster alarm", "Tool gate") without ever saying what
 * they are. That is fine for a plant operator and useless to anyone else —
 * including a judge being shown the product for the first time, which is the
 * audience this surface exists for.
 *
 * Keyed by action kind rather than device kind so the three device-less actions
 * are covered too. The Tier 3 entries carry the refusal argument on their own:
 * "venting cannot be undone" explains the refusal better than any clause list.
 */
const EQUIPMENT_BLURB: Record<string, string> = {
  // Tier 2 · protect
  ventilation_on:
    "Extraction fans in this zone. They pull hazardous gas out of the area.",
  tool_issuance_gate_closed:
    "The counter where crews collect tools. Closing it stops anyone picking up gear and walking in.",
  permit_freeze:
    "The work permit for this asset. Freezing it means no new work can start under it.",
  muster_alarm:
    "The siren that tells everyone to leave and gather at the muster point.",
  // Tier 1 · warn
  pa_announcement:
    "Loudspeakers in the zone, used to tell people what is happening.",
  exclusion_signage: "Lit keep-out signs at the entrances to the zone.",
  page_response_team:
    "A call-out to the on-call responder for this zone. It escalates if nobody answers.",
  // Tier 0 · preserve
  preserve_evidence:
    "A frozen copy of every reading and permit at this moment, so the decision can be audited later.",
  // Tier 3 · never automatic
  unit_shutdown: "Tripping the production unit offline. Restart takes hours.",
  depressurize: "Venting the system to atmosphere. Cannot be undone.",
  evacuation_complete:
    "The all-clear that sends people back in. A false one is fatal.",
};

/** One plain sentence describing what this action physically does. */
export function equipmentBlurb(action: ResponseAction): string | null {
  return EQUIPMENT_BLURB[action.action_kind] ?? null;
}

/** Every action kind the envelope can produce — the blurb map must cover all. */
export const KNOWN_ACTION_KINDS = Object.keys(EQUIPMENT_BLURB);

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
 *
 * `tier_permits_automation` is marked `refusedOnly`: on an action that ran,
 * "tier allows automation" is circular — it did it because it was allowed, and
 * it was allowed because it was allowed. On a refusal it is the entire reason,
 * so it stays. See CLAUSES_FOR_ALLOWED / CLAUSES_FOR_REFUSED below.
 */
export const CLAUSE_LABELS: ReadonlyArray<{
  key: string;
  label: string;
  refusedOnly?: boolean;
}> = [
  {
    key: "tier_permits_automation",
    label: "Needs a person, not a rule",
    refusedOnly: true,
  },
  { key: "reversible", label: "Can be switched back" },
  { key: "fail_safe_direction", label: "Only makes the area safer" },
  { key: "bounded_blast_radius", label: "Stops at this zone" },
];

export const CLAUSES_FOR_ALLOWED = CLAUSE_LABELS.filter((c) => !c.refusedOnly);
export const CLAUSES_FOR_REFUSED = CLAUSE_LABELS;

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
