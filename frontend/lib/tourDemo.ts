"use client";

/**
 * Tour ↔ backend bridge.
 *
 * The Grand Tour drives the *real* platform: Act II asks the backend to replay
 * the scripted VSP coke-oven scenario so the Brain panel streams genuine
 * `agent.step` events and telemetry moves for real. This mirrors the exact
 * start sequence in components/demo/DemoControls.tsx (clear → POST → refresh),
 * kept in one place so the two never drift.
 *
 * If the backend is unreachable the tour must never stall: `startTourScenario`
 * resolves `{ ok: false }` and the caller flips the tour into scripted-fallback
 * mode, where Acts II–III narrate over whatever the twin already shows.
 */

import { API_BASE } from "@/lib/api";
import { useLiveStore } from "@/lib/liveStore";

/** The hero scenario every judge sees — compound risk below the single-sensor line. */
export const TOUR_SCENARIO = "vsp_coke_oven";

export interface TourDemoResult {
  ok: boolean;
  error?: string;
}

async function post(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed (${res.status})`);
  }
}

/**
 * Launch the VSP coke-oven replay. Same order DemoControls.onStart uses:
 * clear stale steps/telemetry, start the scenario, then re-hydrate the store.
 * Returns `{ ok: false }` (never throws) so the overlay can fall back cleanly.
 */
export async function startTourScenario(): Promise<TourDemoResult> {
  const store = useLiveStore.getState();
  try {
    store.clearAgentSteps();
    store.clearTelemetry();
    await post(`/demo/scenarios/${TOUR_SCENARIO}/start`);
    void store.refreshOverview();
    await store.bootstrap();
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
