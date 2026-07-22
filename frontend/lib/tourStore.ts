"use client";

/**
 * The Grand Tour playback store.
 *
 * Deliberately tiny and decoupled from liveStore: it only tracks *where in the
 * script* we are and *how* it is playing. The actual UI is driven by the tour
 * script's onEnter hooks calling liveStore actions directly (see lib/tourScript).
 *
 * Auto-advance is NOT timed here — TourOverlay owns the per-step timer because
 * only it knows when a step's anchor has finished resolving. This store just
 * exposes `next/prev/goTo` and the play state the overlay reacts to.
 */

import { create } from "zustand";
import { TOUR_STEPS } from "@/lib/tourScript";

export type TourMode = "auto" | "interactive";

const SEEN_KEY = "sop-opera-tour-seen";

function readSeen(): boolean {
  if (typeof window === "undefined") return true; // never auto-prompt during SSR
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore — private mode etc. */
  }
}

interface TourState {
  active: boolean;
  mode: TourMode;
  stepIndex: number;
  paused: boolean;
  /** Backend was unreachable at Act II — narrate over the static twin instead. */
  fallbackScripted: boolean;
  /** Cached "already seen the tour" flag, hydrated on the client after mount. */
  hasSeen: boolean;

  start: (mode?: TourMode) => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  setMode: (mode: TourMode) => void;
  togglePause: () => void;
  setPaused: (paused: boolean) => void;
  markFallback: () => void;
  /** Persist the "seen" flag without starting the tour (dismiss the invite). */
  markSeen: () => void;
  /** Re-read the localStorage seen flag (called once on the client). */
  hydrateSeen: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  active: false,
  mode: "interactive",
  stepIndex: 0,
  paused: false,
  fallbackScripted: false,
  hasSeen: true,

  start: (mode = "interactive") => {
    writeSeen();
    set({
      active: true,
      mode,
      stepIndex: 0,
      paused: false,
      fallbackScripted: false,
      hasSeen: true,
    });
  },

  stop: () => set({ active: false, paused: false }),

  next: () => {
    const { stepIndex } = get();
    if (stepIndex >= TOUR_STEPS.length - 1) {
      set({ active: false, paused: false });
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },

  prev: () => {
    const { stepIndex } = get();
    if (stepIndex <= 0) return;
    set({ stepIndex: stepIndex - 1 });
  },

  goTo: (index) => {
    const clamped = Math.max(0, Math.min(index, TOUR_STEPS.length - 1));
    set({ stepIndex: clamped });
  },

  setMode: (mode) => set({ mode }),

  togglePause: () => set((s) => ({ paused: !s.paused })),

  setPaused: (paused) => set({ paused }),

  markFallback: () => set({ fallbackScripted: true }),

  markSeen: () => {
    writeSeen();
    set({ hasSeen: true });
  },

  hydrateSeen: () => set({ hasSeen: readSeen() }),
}));

/** Current script step id while the tour is active; null otherwise. */
export function useTourStepId(): string | null {
  return useTourStore((s) =>
    s.active ? (TOUR_STEPS[s.stepIndex]?.id ?? null) : null,
  );
}
