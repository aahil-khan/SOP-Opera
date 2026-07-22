"use client";

/**
 * "SOP Opera, Season 1: The Coke-Oven Incident" — the Grand Tour script.
 *
 * Staged as an opera in Acts (the product name is a play on *soap opera*). Each
 * step showcases one real surface while advancing the drama of a near-miss being
 * *caught*. Steps drive the real UI through liveStore actions (onEnter) and the
 * real backend (Act II replays the VSP scenario); nothing here is mocked unless
 * the backend is unreachable, in which case the overlay flips to fallback copy.
 *
 * A step with no `anchor` renders as a centered "act card" (an intertitle). A
 * step with an `anchor` spotlights the element carrying that `data-tour` value.
 */

import {
  getLiveAssetViews,
  useLiveStore,
  type AgentStepEvent,
  type AssetDomainFocus,
  type LiveState,
} from "@/lib/liveStore";
import type { TourMode } from "@/lib/tourStore";
import { fetchReports, type AssessmentHistoryItem } from "@/lib/liveApi";
import { normalizeAgentTrace } from "@/lib/reasoningGraph";
import { startTourScenario } from "@/lib/tourDemo";

/** Minimal router surface the overlay hands to onEnter (Next.js AppRouter). */
export interface TourRouter {
  push: (href: string) => void;
}

export interface TourContext {
  router: TourRouter;
  /** Which mode the tour is playing in. Interactive gestures are the user's to
   *  perform, so `onEnter` should only *simulate* them when `mode === "auto"`. */
  mode: TourMode;
  /** Flip the tour into scripted-fallback mode (backend unreachable). */
  markFallback: () => void;
}

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

/**
 * A step the user is meant to *do*, not just read (interactive mode only).
 * Auto/demo mode ignores this entirely and advances on the dwell timer.
 */
export interface TourInteraction {
  /** Prompt shown as a "your turn" affordance on the narration card. */
  hint: string;
  /**
   * Advance when this predicate flips true (the overlay subscribes to the store).
   * Omit for gestures with no observable store signal (e.g. a radar wedge writes
   * component-local state) — the overlay then advances on a click inside the
   * spotlit anchor instead.
   */
  done?: (state: LiveState) => boolean;
}

export interface TourStep {
  id: string;
  /** Intertitle shown above the title, e.g. "Act II · Rising Tension". */
  act: string;
  title: string;
  body: string;
  /** Scripted-fallback copy when the backend never started the scenario. */
  fallbackBody?: string;
  /** Route to be on before this step resolves; pushed if not already there. */
  route?: string;
  /** `data-tour` value to spotlight. Omit for a centered act card. */
  anchor?: string;
  placement?: TourPlacement;
  /** Auto-play dwell in ms (interactive mode ignores this). */
  autoMs?: number;
  /** Drive real state: select an asset, start the scenario, deep-link, etc. */
  onEnter?: (ctx: TourContext) => void | Promise<void>;
  /**
   * Hold the spotlight until this predicate holds (e.g. the review has settled
   * out of `assessing`), so we never highlight a panel that is about to swap.
   * Generous: the overlay resolves the anchor anyway once the poll cap elapses.
   */
  waitUntil?: (state: LiveState) => boolean;
  /** Make this a hands-on step in interactive mode (see TourInteraction). */
  interactive?: TourInteraction;
}

const DEFAULT_DWELL = 6500;

/* ── Runtime resolvers ─────────────────────────────────────────────────────
   The hero asset/review aren't known until the VSP scenario spawns them, so we
   resolve them live from the store at step time rather than hardcoding ids. */

/** Highest-risk reviewed asset — after the VSP replay this is the coke oven. */
export function heroAssetId(): string | null {
  const views = getLiveAssetViews(useLiveStore.getState());
  if (views.length === 0) return null;
  const rank = { blocking: 3, elevated: 2, nominal: 1 } as const;
  const scored = views
    .map((v) => ({
      v,
      score:
        (rank[v.risk_level] ?? 0) * 10 +
        (v.review ? 4 : 0) +
        (v.sensor_critical ? 2 : 0) +
        (/coke|oven/i.test(`${v.asset.name} ${v.asset.zone}`) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.v;
  // Prefer a genuinely reviewed asset; fall back to the first asset on the map.
  return best?.review ? best.asset.id : (best?.asset.id ?? null);
}

/** The review id backing the hero asset — the Brain panel's data source. */
export function heroReviewId(): string | null {
  const id = heroAssetId();
  if (!id) return null;
  const view = getLiveAssetViews(useLiveStore.getState()).find(
    (v) => v.asset.id === id,
  );
  return view?.review?.id ?? null;
}

/** The hero asset's live view, if it exists yet. */
function heroView() {
  const id = heroAssetId();
  if (!id) return undefined;
  return getLiveAssetViews(useLiveStore.getState()).find(
    (v) => v.asset.id === id,
  );
}

/** True once the VSP replay has spawned a review for the hero asset. */
export function heroReviewExists(): boolean {
  return Boolean(heroView()?.review);
}

/**
 * True once the hero review is out of `assessing` — i.e. the AssetPanel shows
 * the settled evidence view, not the Brain panel. Used to gate the Act IV steps
 * so a re-assessment (VSP break #2) can't yank the spotlight mid-highlight.
 */
export function heroReviewSettled(): boolean {
  const review = heroView()?.review;
  return Boolean(review && review.state !== "assessing");
}

/** Select the hero asset in summary mode (Brain panel + radar visible). */
function focusHeroSummary(): void {
  const id = heroAssetId();
  if (id) {
    const store = useLiveStore.getState();
    store.selectAsset(id);
    store.setAssetPanelMode("summary");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function traceFromAssessment(
  assessment: AssessmentHistoryItem | null | undefined,
): AgentStepEvent[] {
  if (!assessment) return [];
  const raw =
    assessment.agent_trace ??
    assessment.metadata?.agent_trace ??
    [];
  return normalizeAgentTrace(raw, assessment);
}

/**
 * Open the hero Brain panel with a stable cast list.
 *
 * Mock assessments finish in ~1–2s — long before this act — so live `agent.step`
 * events are often already gone and the panel would unmount. We wait for the
 * review, hydrate from the persisted `agent_trace` when the live stream is
 * empty, then select the asset so the tour freezes a full history view.
 */
async function prepareCastBrain(): Promise<void> {
  const deadline = Date.now() + 12_000;

  // Scenario may still be mid-replay — poll until a reviewed hero exists.
  while (Date.now() < deadline) {
    const store = useLiveStore.getState();
    await store.refreshOverview().catch(() => {});
    if (heroReviewId()) break;
    await sleep(250);
  }

  const reviewId = heroReviewId();
  const assetId = heroAssetId();
  if (!reviewId || !assetId) {
    focusHeroSummary();
    return;
  }

  // Hold the panel closed until we have a full cast (verdict), or a completed
  // assessment we can rehydrate — otherwise the act opens on an empty/partial stream.
  while (Date.now() < deadline) {
    const store = useLiveStore.getState();
    await store.loadReviewDetail(reviewId).catch(() => {});

    const live = store.agentStepsByReview[reviewId] ?? [];
    if (live.some((s) => s.kind === "verdict")) {
      break;
    }

    const assessments =
      useLiveStore.getState().assessmentsByReview[reviewId] ?? [];
    const complete = assessments.find((a) => a.status === "complete");
    const fromTrace = traceFromAssessment(complete);
    if (fromTrace.some((s) => s.kind === "verdict") || fromTrace.length > 0) {
      // Prefer trace when the live WS stream was missed (assessment already done).
      if (live.length === 0 || fromTrace.length >= live.length) {
        useLiveStore.getState().seedAgentStepsForReview(reviewId, fromTrace);
      }
      break;
    }

    await sleep(250);
  }

  const store = useLiveStore.getState();
  store.selectAsset(assetId);
  store.setAssetPanelMode("summary");
}

/** Auto-mode stand-in for the "click a wedge" gesture: pin the busiest domain. */
function pinHeroDomain(): void {
  const view = heroView();
  if (!view) return;
  // Prefer the domain most likely to carry signal in the coke-oven arc; the
  // radar simply ignores a domain it has no data for, so this is best-effort.
  const order: AssetDomainFocus[] = [
    "sensors",
    "permits",
    "people",
    "evidence",
    "spatial",
  ];
  useLiveStore.getState().openAssetDomain(view.asset.id, order[0]);
}

/* ── The script ────────────────────────────────────────────────────────────*/

export const TOUR_STEPS: TourStep[] = [
  // ── Overture ──────────────────────────────────────────────────────────
  {
    id: "overture",
    act: "Overture",
    title: "The data was always there.",
    body:
      "In disasters like the Visakhapatnam coke-oven explosion, the sensors were reading, the permits were filed, the crews were logged — but nothing connected them into a decision in time. SOP Opera is that missing intelligence layer. Take your seats: here's the whole show in ninety seconds.",
    route: "/operator",
    placement: "center",
    autoMs: 8000,
  },

  // ── Act I · The Stage ─────────────────────────────────────────────────
  {
    id: "stage-map",
    act: "Act I · The Stage",
    title: "A living plant, not a dashboard.",
    body:
      "This is the digital twin — every asset across three floors, breathing with live telemetry. Calm markers are nominal; a pulsing marker means the risk engine is watching something. This is where the supervisor's eyes live.",
    route: "/operator",
    anchor: "twin-map",
    placement: "right",
    autoMs: 7000,
  },

  // ── Act II · Rising Tension ───────────────────────────────────────────
  {
    id: "tension-start",
    act: "Act II · Rising Tension",
    title: "Watch the conditions converge.",
    body:
      "We're replaying the coke-oven scenario for real. Gas creeps up. A permit is open. A crew is in the zone. No single reading has crossed its critical line — yet the compound engine is already tightening. That gap is the whole point.",
    fallbackBody:
      "The backend isn't reachable, so we'll narrate over the static twin: in the coke-oven scenario, gas creeps up while a permit is open and a crew is in the zone. No single reading crosses its critical line — yet the compound engine already flags danger. That gap is the whole point.",
    route: "/operator",
    anchor: "twin-map",
    placement: "right",
    autoMs: 9000,
    onEnter: async (ctx) => {
      const result = await startTourScenario();
      if (!result.ok) ctx.markFallback();
    },
  },

  // ── Act III · The Cast Deliberates ────────────────────────────────────
  {
    id: "cast-select",
    act: "Act III · The Cast Deliberates",
    title: "Open the flagged asset's file.",
    body:
      "The compound engine has singled out an asset — its marker is pulsing on the map. Click it to open its file. This is the core gesture: every asset on the twin is one click from its full risk picture.",
    fallbackBody:
      "The compound engine singles out an asset and its marker pulses on the map. Clicking it opens the asset's file — every asset on the twin is one click from its full risk picture.",
    route: "/operator",
    anchor: "twin-map",
    placement: "right",
    autoMs: 6000,
    interactive: {
      hint: "Click the pulsing marker on the map to open its file.",
      done: (s) => s.selectedAssetId != null,
    },
    // Auto/demo mode performs the click for you; interactive mode waits for it.
    onEnter: (ctx) => {
      if (ctx.mode === "auto") focusHeroSummary();
    },
  },
  {
    id: "cast-brain",
    act: "Act III · The Cast Deliberates",
    title: "Meet the cast — the AI agents.",
    body:
      "The file opens on the Brain panel. Each line is a specialist agent reasoning in real time — reading sensors, permits, maintenance and crew, then pulling matching regulations, past incidents and SOPs. Every claim they make is cited.",
    fallbackBody:
      "This is the Brain panel: each line is a specialist agent — sensors, permits, maintenance, crew — reasoning in real time, then pulling matching regulations, past incidents and SOPs. Every claim they make is cited back to a source.",
    route: "/operator",
    anchor: "brain-panel",
    placement: "left",
    autoMs: 10000,
    waitUntil: () => heroReviewExists(),
    onEnter: () => prepareCastBrain(),
  },

  // ── Act IV · The Evidence ─────────────────────────────────────────────
  {
    id: "evidence-radar",
    act: "Act IV · The Evidence",
    title: "Five domains, one shape.",
    body:
      "The radar fuses five evidence domains — sensors, permits, people, evidence and spatial — into a single silhouette. A lopsided pentagon tells the supervisor at a glance where the danger is coming from. Try it: click any wedge to open that domain's detail.",
    route: "/operator",
    anchor: "domain-radar",
    placement: "left",
    autoMs: 7000,
    waitUntil: () => heroReviewSettled(),
    interactive: {
      // No store predicate: a wedge click writes DomainRadar-local `pinned`
      // state, so the overlay advances on a click inside the spotlit radar.
      hint: "Click any wedge on the pentagon to open its domain.",
    },
    onEnter: (ctx) => {
      focusHeroSummary();
      if (ctx.mode === "auto") pinHeroDomain();
    },
  },
  {
    id: "evidence-why",
    act: "Act IV · The Evidence",
    title: "Why, in plain language.",
    body:
      "No jargon wall. The Why brief states the compound hazard in one honest paragraph — the pathway from atmosphere to ignition to exposure — so anyone on the floor understands the call, not just the model.",
    route: "/operator",
    anchor: "why-brief",
    placement: "left",
    autoMs: 6500,
    waitUntil: () => heroReviewSettled(),
    onEnter: () => focusHeroSummary(),
  },
  {
    id: "evidence-forecast",
    act: "Act IV · The Evidence",
    title: "Time you didn't have before.",
    body:
      "The trend forecast projects each signal forward and marks when it would cross the incident line. This is the lead time — minutes of warning that turn a reaction into a decision.",
    route: "/operator",
    anchor: "forecast",
    placement: "left",
    autoMs: 6500,
    waitUntil: () => heroReviewSettled(),
    onEnter: () => focusHeroSummary(),
  },
  {
    id: "evidence-vindicated",
    act: "Act IV · The Evidence",
    title: "The line it beat.",
    body:
      "Then it happens: minutes later, gas finally crosses the single-sensor critical line — the alarm the old world waited for. But the compound engine had already blocked this asset long before, while every gauge still read 'safe'. That gap is the whole thesis: danger is a pattern, not a threshold.",
    fallbackBody:
      "Here's the thesis: a single sensor only alarms once it crosses its own critical line. The compound engine blocked this asset long before that, reading the pattern across gas, permits and people while every gauge still said 'safe'. Danger is a pattern, not a threshold.",
    route: "/operator",
    anchor: "forecast",
    placement: "left",
    autoMs: 8000,
    waitUntil: () => heroReviewSettled(),
    onEnter: () => focusHeroSummary(),
  },

  // ── Act V · The Verdict ───────────────────────────────────────────────
  {
    id: "verdict",
    act: "Act V · The Verdict",
    title: "The human writes the ending.",
    body:
      "The AI assesses and recommends — but it never acts. The supervisor records the binding decision here: approve, approve with conditions, or block. That human signature is what makes the whole trail defensible.",
    route: "/operator",
    anchor: "decision",
    placement: "left",
    autoMs: 7500,
    onEnter: () => focusHeroSummary(),
  },

  // ── Act VI · The Vault ────────────────────────────────────────────────
  {
    id: "vault",
    act: "Act VI · The Vault",
    title: "Evidence, frozen and sealed.",
    body:
      "When a review closes, its decision, evidence and citations freeze into a versioned, hash-chained packet — exportable to PDF or Excel. The Audit-trail tab re-computes the chain and proves nothing was altered after the fact.",
    route: "/reports",
    anchor: "audit-chain",
    placement: "top",
    autoMs: 8000,
    onEnter: async (ctx) => {
      // Deep-link into a real sealed report if one exists; otherwise the
      // spotlight falls back to the reports register itself.
      try {
        const reports = await fetchReports({});
        const first = reports[0];
        if (first?.id) ctx.router.push(`/reports/${first.id}`);
      } catch {
        /* stay on the register — anchor times out to a centered card */
      }
    },
  },

  // ── Act VII · Changing of the Guard ───────────────────────────────────
  {
    id: "handover",
    act: "Act VII · Changing of the Guard",
    title: "Custody, not a clipboard.",
    body:
      "Shifts don't just clock out — they hand over custody of the plant. The outgoing operator issues open risks and carry-forward items; the incoming operator must accept them before taking control. Every transfer lands in the audit chain.",
    route: "/handover",
    anchor: "handover",
    placement: "top",
    autoMs: 7500,
  },

  // ── Act VIII · The Scoreboard ─────────────────────────────────────────
  {
    id: "scoreboard-eval",
    act: "Act VIII · The Scoreboard",
    title: "Does compound actually beat single-sensor?",
    body:
      "Yes — and here's the receipt. The scorecard runs both detectors over the same history: the compound engine catches near-misses the single-sensor baseline misses entirely, and flags them minutes earlier. Fewer false negatives, real lead time.",
    route: "/eval",
    anchor: "eval-scorecard",
    placement: "top",
    autoMs: 8000,
  },
  {
    id: "scoreboard-aiops",
    act: "Act VIII · The Scoreboard",
    title: "The pit crew's view.",
    body:
      "Behind the show, AI Ops tracks the pipeline itself — latency, tokens, cost and success rate per agent run. It's how this stays trustworthy and affordable as the plant, and the fleet, scale up.",
    route: "/ai-ops",
    anchor: "aiops",
    placement: "top",
    autoMs: 7000,
  },

  // ── Curtain Call ──────────────────────────────────────────────────────
  {
    id: "curtain",
    act: "Curtain Call",
    title: "That's the show.",
    body:
      "Live twin → compound risk → reasoning agents → a human decision → a sealed audit trail. Sensors to accountability, in one loop. The stage is yours now — start a scenario from the Demo menu, or replay this tour any time.",
    placement: "center",
    autoMs: 9000,
  },
];

export { DEFAULT_DWELL };
