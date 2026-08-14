"use client";

/**
 * Tour ↔ backend bridge.
 *
 * The Grand Tour drives the *real* platform: Act II asks the backend to
 * auto-play `compound_risk` (`POST /demo/scenarios/.../start`) so the Brain
 * panel streams genuine `agent.step` events. Live video demos should use the
 * top-bar manual path instead (`/arm` + `/step`) — this helper stays on timed
 * auto-play so the tour can advance without click-through.
 *
 * We deliberately use `compound_risk` — not `vsp_coke_oven` — so the tour
 * never fights a late re-assessment when gas later crosses critical. The demo
 * arc is paced for narration and ends without a critical-gas climb.
 *
 * If the backend is unreachable the tour must never stall: `startTourScenario`
 * resolves `{ ok: false }` and the caller flips the tour into scripted-fallback
 * mode, where Acts II–III narrate over whatever the twin already shows.
 */

import { API_BASE } from "@/lib/api";
import { useLiveStore } from "@/lib/liveStore";

/** Short compound demo — one assessment arc, no late critical re-break. */
export const TOUR_SCENARIO = "compound_risk";

export interface TourDemoResult {
  ok: boolean;
  error?: string;
}

/** POST that returns the HTTP status instead of throwing, so callers can branch
 *  on 409 (scenario already running) without a try/catch dance. */
async function postStatus(path: string): Promise<number> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  return res.status;
}

async function post(path: string): Promise<void> {
  const status = await postStatus(path);
  if (status < 200 || status >= 300) {
    throw new Error(`POST ${path} failed (${status})`);
  }
}

/**
 * Launch the compound-risk replay for the Grand Tour (timed auto-play).
 * Manual demos use /arm + /step from the top bar instead.
 * Same order DemoControls used to use for auto start (clear → POST → refresh),
 * kept in one place so the tour never drifts from a working start path.
 */
export async function startTourScenario(): Promise<TourDemoResult> {
  const store = useLiveStore.getState();
  try {
    store.clearAgentSteps();
    store.clearTelemetry();
    let status = await postStatus(`/demo/scenarios/${TOUR_SCENARIO}/start`);
    // 409 = a scenario is already running (e.g. a replay of the tour). Reset the
    // plant and try once more so re-launching always re-arms the arc cleanly.
    if (status === 409) {
      await post("/demo/reset");
      status = await postStatus(`/demo/scenarios/${TOUR_SCENARIO}/start`);
    }
    if (status < 200 || status >= 300) {
      throw new Error(`start scenario failed (${status})`);
    }
    // Don't await bootstrap — overview refresh is enough for the twin to paint;
    // WS + later acts hydrate the rest. Awaiting bootstrap lagged Act II.
    void store.refreshOverview();
    void store.bootstrap();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Best-effort return of the plant to idle after a demo. Never throws — leaving
 * the scenario running is harmless, so a failed reset is silently ignored.
 */
export async function resetTourScenario(): Promise<void> {
  const store = useLiveStore.getState();
  try {
    await post("/demo/reset");
    store.clearAgentSteps();
    store.clearTelemetry();
    await store.bootstrap();
  } catch {
    /* ignore — reset is a courtesy, not a requirement */
  }
}
