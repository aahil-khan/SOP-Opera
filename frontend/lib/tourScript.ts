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

import { getLiveAssetViews, useLiveStore } from "@/lib/liveStore";
import { fetchReports } from "@/lib/liveApi";
import { startTourScenario } from "@/lib/tourDemo";

/** Minimal router surface the overlay hands to onEnter (Next.js AppRouter). */
export interface TourRouter {
  push: (href: string) => void;
}

export interface TourContext {
  router: TourRouter;
  /** Flip the tour into scripted-fallback mode (backend unreachable). */
  markFallback: () => void;
}

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center";

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

/** Select the hero asset in summary mode (Brain panel + radar visible). */
function focusHeroSummary(): void {
  const id = heroAssetId();
  if (id) {
    const store = useLiveStore.getState();
    store.selectAsset(id);
    store.setAssetPanelMode("summary");
  }
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
    id: "cast-brain",
    act: "Act III · The Cast Deliberates",
    title: "Meet the cast — the AI agents.",
    body:
      "Select the flagged asset and the Brain panel opens. Each line is a specialist agent reasoning in real time — reading sensors, permits, maintenance and crew, then pulling matching regulations, past incidents and SOPs. Every claim they make is cited.",
    fallbackBody:
      "This is the Brain panel: each line is a specialist agent — sensors, permits, maintenance, crew — reasoning in real time, then pulling matching regulations, past incidents and SOPs. Every claim they make is cited back to a source.",
    route: "/operator",
    anchor: "brain-panel",
    placement: "left",
    autoMs: 9000,
    onEnter: () => focusHeroSummary(),
  },

  // ── Act IV · The Evidence ─────────────────────────────────────────────
  {
    id: "evidence-radar",
    act: "Act IV · The Evidence",
    title: "Five domains, one shape.",
    body:
      "The radar fuses five evidence domains — sensors, permits, people, evidence and spatial — into a single silhouette. A lopsided pentagon tells the supervisor at a glance where the danger is coming from. Click any wedge to open the detail.",
    route: "/operator",
    anchor: "domain-radar",
    placement: "left",
    autoMs: 7000,
    onEnter: () => focusHeroSummary(),
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
    onEnter: () => {
      const id = heroAssetId();
      if (id) useLiveStore.getState().openAssetFullReview(id);
    },
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
