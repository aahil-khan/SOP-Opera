import { isDndEnabled } from "@/lib/dndMode";

/**
 * Soft two-tone chime for newly opened reviews.
 * Uses Web Audio so we don't ship a binary asset; unlocks on first gesture.
 */

let audioCtx: AudioContext | null = null;
let unlocked = false;
let lastChimeAt = 0;

const CHIME_COOLDOWN_MS = 800;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  return audioCtx;
}

function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number,
  gainPeak: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Call once from a user gesture so later review chimes are allowed. */
export function unlockReviewChime(): void {
  const ctx = getCtx();
  if (!ctx) return;
  void ctx.resume().then(() => {
    unlocked = true;
  });
}

/** Subtle A5 → E6 bell; no-ops if autoplay is still locked or called too often. */
export function playNewReviewChime(): void {
  if (typeof window === "undefined" || isDndEnabled()) return;
  const now = Date.now();
  if (now - lastChimeAt < CHIME_COOLDOWN_MS) return;
  lastChimeAt = now;

  const ctx = getCtx();
  if (!ctx) return;

  const run = () => {
    unlocked = true;
    const t = ctx.currentTime;
    tone(ctx, 880, t, 0.22, 0.045);
    tone(ctx, 1318.5, t + 0.12, 0.32, 0.035);
  };

  if (ctx.state === "suspended") {
    void ctx.resume().then(run).catch(() => {});
    return;
  }
  if (!unlocked && ctx.state !== "running") return;
  try {
    run();
  } catch {
    /* ignore autoplay / context errors */
  }
}
