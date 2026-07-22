"use client";

/**
 * "SOP Opera, Season 1" — the Grand Tour script.
 *
 * Staged as an opera in Acts (the product name is a play on *soap opera*). Each
 * step showcases one real surface while advancing a near-miss being *caught*.
 * Steps drive the real UI through liveStore actions (onEnter) and the real
 * backend (Act II replays the short `compound_risk` scenario — one assessment
 * arc, no late critical re-break). Nothing here is mocked unless the backend is
 * unreachable, in which case the overlay flips to fallback copy.
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
import {
  fetchReports,
  fetchReviewReports,
  type AssessmentHistoryItem,
} from "@/lib/liveApi";
import { normalizeAgentTrace } from "@/lib/reasoningGraph";
import { startTourScenario } from "@/lib/tourDemo";
import { trendForecastForAssessment } from "@/lib/trendForecast";

/** Minimal router surface the overlay hands to onEnter (Next.js AppRouter). */
export interface TourRouter {
  push: (href: string) => void;
  prefetch?: (href: string) => void;
}

export interface TourContext {
  router: TourRouter;
  /** Which mode the tour is playing in. Interactive gestures are the user's to
   *  perform, so `onEnter` should only *simulate* them when `mode === "auto"`. */
  mode: TourMode;
  /** Flip the tour into scripted-fallback mode (backend unreachable). */
  markFallback: () => void;
}

export type TourPlacement = "top" | "bottom" | "left" | "right" | "center" | "corner";

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
   * spotlit anchor, unless `advanceOnClick` is false.
   */
  done?: (state: LiveState) => boolean;
  /**
   * When there is no `done` predicate, a click inside the spotlight advances by
   * default. Set false when the gesture should open inspectable UI first (e.g.
   * a domain flyout) — the user continues with Next after looking.
   */
  advanceOnClick?: boolean;
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
  /**
   * Optional surface gate. Once `waitUntil` (if any) has passed, the overlay
   * briefly retries this predicate; if it stays false the step is skipped
   * entirely (e.g. trend forecast is not always in the assessment).
   */
  availableWhen?: (state: LiveState) => boolean;
  /**
   * While false, Next stays disabled and auto-advance is held — the step is
   * visible (e.g. Brain casting) but the audience must wait for the gate
   * (assessment finished) before continuing.
   */
  holdNextUntil?: (state: LiveState) => boolean;
  /**
   * Wait for `onEnter` to finish before resolving the spotlight (deep-links,
   * seal-then-open). Default is fire-and-forget so map steps don't lag.
   */
  awaitEnter?: boolean;
  /** Make this a hands-on step in interactive mode (see TourInteraction). */
  interactive?: TourInteraction;
}

const DEFAULT_DWELL = 6500;

/* ── Runtime resolvers ─────────────────────────────────────────────────────
   The hero asset/review aren't known until the demo scenario spawns them, so we
   resolve them live from the store at step time rather than hardcoding ids. */

/** Highest-risk reviewed asset — after compound_risk this is Vessel A. */
export function heroAssetId(state: LiveState = useLiveStore.getState()): string | null {
  const views = getLiveAssetViews(state);
  if (views.length === 0) return null;
  const rank = { blocking: 3, elevated: 2, nominal: 1 } as const;
  const scored = views
    .map((v) => ({
      v,
      score:
        (rank[v.risk_level] ?? 0) * 10 +
        (v.review ? 4 : 0) +
        (v.sensor_critical ? 2 : 0) +
        (/vessel\s*a/i.test(v.asset.name) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.v;
  // Prefer a genuinely reviewed asset; fall back to the first asset on the map.
  return best?.review ? best.asset.id : (best?.asset.id ?? null);
}

/** The review id backing the hero asset — the Brain panel's data source. */
export function heroReviewId(state: LiveState = useLiveStore.getState()): string | null {
  const id = heroAssetId(state);
  if (!id) return null;
  const view = getLiveAssetViews(state).find((v) => v.asset.id === id);
  return view?.review?.id ?? null;
}

/** The hero asset's live view, if it exists yet. */
function heroView(state: LiveState = useLiveStore.getState()) {
  const id = heroAssetId(state);
  if (!id) return undefined;
  return getLiveAssetViews(state).find((v) => v.asset.id === id);
}

/** True once the demo replay has spawned a review for the hero asset. */
export function heroReviewExists(state: LiveState = useLiveStore.getState()): boolean {
  return Boolean(heroView(state)?.review);
}

/**
 * True once the hero review is out of `assessing` — i.e. the AssetPanel shows
 * the settled evidence view, not the Brain panel. Gates Act IV so we don't
 * spotlight a panel that is about to swap.
 */
export function heroReviewSettled(state: LiveState = useLiveStore.getState()): boolean {
  const review = heroView(state)?.review;
  return Boolean(review && review.state !== "assessing");
}

/** True when the hero assessment has a trend-forecast card to spotlight. */
export function heroForecastAvailable(
  state: LiveState = useLiveStore.getState(),
): boolean {
  const view = heroView(state);
  const reviewId = view?.review?.id;
  if (!reviewId) return false;
  const history = state.assessmentsByReview[reviewId];
  const assessment =
    view?.assessment ??
    history?.find((a) => a.status === "complete") ??
    history?.[0] ??
    null;
  const liveSteps = state.agentStepsByReview[reviewId] ?? [];
  return trendForecastForAssessment(assessment, liveSteps) != null;
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

/**
 * Decide + close the tour hero review so a sealed packet lands on /reports,
 * then return that report id. Idempotent if the review is already sealed.
 */
async function sealTourHeroReview(): Promise<string | null> {
  const reviewId = heroReviewId();
  if (!reviewId) return null;

  const store = useLiveStore.getState();

  // Already sealed? One round-trip, then we're done.
  try {
    const [listed, byReview] = await Promise.all([
      fetchReports({ review_id: reviewId, limit: 1 }),
      fetchReviewReports(reviewId).catch(() => [] as Awaited<
        ReturnType<typeof fetchReviewReports>
      >),
    ]);
    if (listed[0]?.id) return listed[0].id;
    const current = byReview.find((r) => r.is_current) ?? byReview[0];
    if (current?.id) return current.id;
  } catch {
    /* keep going — we may still be able to decide/close */
  }

  await store.loadReviewDetail(reviewId).catch(() => {});

  const view = heroView();
  let review = view?.review ?? store.reviewDetails[reviewId]?.review ?? null;
  if (!review) return null;

  if (review.state !== "decided" && review.state !== "closed") {
    const assessment =
      view?.assessment ??
      store.assessmentsByReview[reviewId]?.find((a) => a.status === "complete") ??
      store.assessmentsByReview[reviewId]?.[0] ??
      null;
    if (!assessment || assessment.status !== "complete") return null;

    const dispositions = Object.fromEntries(
      (assessment.recommendations ?? []).map((rec) => [
        rec.id,
        "accepted" as const,
      ]),
    );
    try {
      await store.submitDecision(reviewId, {
        outcome: "blocked",
        recommendation_dispositions: dispositions,
        conditions: null,
        comments: "Tour demo — sealed for the vault act.",
        tagged_worker_ids: [],
      });
    } catch {
      await store.loadReviewDetail(reviewId).catch(() => {});
    }
  }

  review =
    heroView()?.review ?? store.reviewDetails[reviewId]?.review ?? review;

  if (review?.state === "decided") {
    try {
      await store.closeReview(reviewId);
    } catch {
      /* report may still appear if close raced */
    }
  }

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const [listed, byReview] = await Promise.all([
        fetchReports({ review_id: reviewId, limit: 1 }),
        fetchReviewReports(reviewId).catch(() => [] as Awaited<
          ReturnType<typeof fetchReviewReports>
        >),
      ]);
      if (listed[0]?.id) return listed[0].id;
      const current = byReview.find((r) => r.is_current) ?? byReview[0];
      if (current?.id) return current.id;
    } catch {
      /* retry */
    }
    await sleep(120);
  }
  return null;
}

/**
 * Seal the tour review, then open its report packet in one navigation
 * (avoids /reports → /reports/id thrash that lagged the vault act).
 */
async function prepareVaultReport(ctx: TourContext): Promise<void> {
  const reportId = await sealTourHeroReview();
  if (reportId) {
    ctx.router.prefetch?.(`/reports/${reportId}`);
    ctx.router.push(`/reports/${reportId}`);
    return;
  }
  ctx.router.push("/reports");
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
  const deadline = Date.now() + 8_000;

  // Wait for a reviewed hero — refresh once, then listen to the store instead
  // of hammering refreshOverview every 250ms (that lagged Act III).
  if (!heroReviewId()) {
    await useLiveStore.getState().refreshOverview().catch(() => {});
  }
  if (!heroReviewId()) {
    await new Promise<void>((resolve) => {
      const unsub = useLiveStore.subscribe(() => {
        if (heroReviewId()) {
          unsub();
          clearTimeout(timer);
          resolve();
        }
      });
      const timer = setTimeout(() => {
        unsub();
        resolve();
      }, deadline - Date.now());
      void useLiveStore.getState().refreshOverview().catch(() => {});
    });
  }

  const reviewId = heroReviewId();
  const assetId = heroAssetId();
  if (!reviewId || !assetId) {
    focusHeroSummary();
    return;
  }

  // Hydrate cast once; retry briefly if the assessment is still mid-flight.
  while (Date.now() < deadline) {
    const store = useLiveStore.getState();
    await store.loadReviewDetail(reviewId).catch(() => {});

    const live = store.agentStepsByReview[reviewId] ?? [];
    if (live.some((s) => s.kind === "verdict")) break;

    const assessments =
      useLiveStore.getState().assessmentsByReview[reviewId] ?? [];
    const complete = assessments.find((a) => a.status === "complete");
    const fromTrace = traceFromAssessment(complete);
    if (fromTrace.some((s) => s.kind === "verdict") || fromTrace.length > 0) {
      if (live.length === 0 || fromTrace.length >= live.length) {
        useLiveStore.getState().seedAgentStepsForReview(reviewId, fromTrace);
      }
      break;
    }

    // Assessment still running — wait for WS/store, not a blind sleep loop.
    await new Promise<void>((resolve) => {
      const unsub = useLiveStore.subscribe((s) => {
        const steps = s.agentStepsByReview[reviewId] ?? [];
        if (steps.some((x) => x.kind === "verdict")) {
          unsub();
          clearTimeout(t);
          resolve();
        }
      });
      const t = setTimeout(() => {
        unsub();
        resolve();
      }, 400);
    });
  }

  const store = useLiveStore.getState();
  store.selectAsset(assetId);
  store.setAssetPanelMode("summary");
}

/** Auto-mode stand-in for the "click a wedge" gesture: pin the busiest domain. */
function pinHeroDomain(): void {
  const view = heroView();
  if (!view) return;
  // Prefer domains the compound_risk arc actually lights up.
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
    onEnter: (ctx) => {
      // Warm the later acts so Act VI+ route swaps aren't cold.
      ctx.router.prefetch?.("/reports");
      ctx.router.prefetch?.("/handover");
      ctx.router.prefetch?.("/eval");
      ctx.router.prefetch?.("/ai-ops");
    },
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
      "We're replaying a short compound-risk demo for real. Gas rises. A crew enters the zone. Overlapping permits activate. No single reading has to scream on its own — the compound engine fuses them and flags the pathway.",
    fallbackBody:
      "The backend isn't reachable, so we'll narrate over the static twin: gas rises, a crew enters the zone, overlapping permits activate — and the compound engine flags the pathway even when no single alarm owns the call.",
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
    anchor: "hero-marker",
    placement: "right",
    autoMs: 6000,
    interactive: {
      hint: "Click the pulsing marker on the map to open its file.",
      done: (s) => s.selectedAssetId != null,
    },
    // Auto/demo mode performs the click for you; interactive mode waits for it
    // (DigitalTwin zooms to the hero floor and leaves only that marker live).
    onEnter: (ctx) => {
      if (ctx.mode === "auto") {
        focusHeroSummary();
        return;
      }
      // Clear any prior selection so Back→cast-select doesn't auto-advance,
      // and so the spotlight hole is the only way to open the file.
      useLiveStore.getState().selectAsset(null);
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
    waitUntil: (s) => heroReviewExists(s),
    // Watch the cast work — Next stays locked until the assessment settles.
    holdNextUntil: (s) => heroReviewSettled(s),
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
    waitUntil: (s) => heroReviewSettled(s),
    interactive: {
      // Wedge click opens DomainDetailFlyout (local state) — don't auto-advance
      // or the flyout never gets a chance to be read. User continues with Next.
      hint: "Click any wedge on the pentagon to open its domain, then continue.",
      advanceOnClick: false,
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
    waitUntil: (s) => heroReviewSettled(s),
    // Same scroll pattern as domain-radar: interactive bands forward wheel to
    // the asset-panel scrollport so a long Why isn't trapped under the dim.
    interactive: {
      hint: "Scroll the panel to read the full Why, then continue.",
      advanceOnClick: false,
    },
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
    waitUntil: (s) => heroReviewSettled(s),
    // Predictive-trend is gated in the agent graph — skip this beat when the
    // assessment has no forecast card rather than narrating over empty UI.
    availableWhen: (s) => heroForecastAvailable(s),
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
    waitUntil: (s) => heroReviewSettled(s),
    onEnter: () => focusHeroSummary(),
  },

  // ── Act VI · The Vault ────────────────────────────────────────────────
  {
    id: "vault",
    act: "Act VI · The Vault",
    title: "Evidence, frozen and sealed.",
    body:
      "When a review closes, its decision, evidence and citations freeze into a versioned, hash-chained packet — exportable to PDF or Excel. The Audit-trail tab re-computes the chain and proves nothing was altered after the fact.",
    // No `route: /reports` — onEnter seals the hero review then deep-links the
    // packet in one hop. A list→detail double push fought the overlay and lagged.
    anchor: "audit-chain",
    placement: "corner",
    autoMs: 8000,
    awaitEnter: true,
    onEnter: (ctx) => prepareVaultReport(ctx),
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
    placement: "corner",
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
    placement: "corner",
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
    placement: "corner",
    autoMs: 7000,
  },

  // ── Curtain Call ──────────────────────────────────────────────────────
  {
    id: "curtain",
    act: "Curtain Call",
    title: "That's the show.",
    body:
      "Live twin → compound risk → reasoning agents → a human decision → a sealed audit trail. Sensors to accountability, in one loop. The stage is yours now — start a scenario from the Demo menu, or replay this tour any time.",
    route: "/operator",
    placement: "center",
    autoMs: 9000,
    onEnter: () => {
      // Land back on the twin with a clear desk for the curtain call.
      useLiveStore.getState().selectAsset(null);
    },
  },
];

export { DEFAULT_DWELL };
