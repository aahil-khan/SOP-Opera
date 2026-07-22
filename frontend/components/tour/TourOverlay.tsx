"use client";

/**
 * The Grand Tour overlay + step engine.
 *
 * Mounted once (beside AppToaster in app/layout.tsx) so it survives route
 * changes between acts. When the tour is inactive it renders only the tiny
 * first-visit invite — a single boolean subscription, no cost on the hot twin.
 *
 * Per active step the engine: (1) navigates to step.route if needed, (2) runs
 * step.onEnter once (drives liveStore / starts the real scenario), (3) polls
 * for the `data-tour` anchor and spotlights it — timing out to a centered "act
 * card" if it never appears, so a missing anchor degrades instead of hanging,
 * and (4) in auto mode, dwells then advances once the spotlight has landed.
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DWELL,
  TOUR_STEPS,
  type TourContext,
  type TourPlacement,
} from "@/lib/tourScript";
import { useLiveStore } from "@/lib/liveStore";
import { useTourStore } from "@/lib/tourStore";
import { NarrationCard } from "./NarrationCard";
import { Spotlight } from "./Spotlight";
import { TourInvite } from "./TourInvite";
import styles from "./TourOverlay.module.css";

/** Breathing room (px) around the spotlit element and between it and the card. */
const ANCHOR_PAD = 8;
/** Keep the ring fully on-screen — edge-flush targets used to clip the halo. */
const VIEWPORT_MARGIN = 12;
const CARD_GAP = 16;
const CARD_WIDTH = 360;
/** Anchor/readiness poll cadence + cap (~6s) before degrading to a centered card. */
const POLL_MS = 150;
const POLL_MAX = 40;
/** Settle loop: frames of a stable rect to accept, and a hard frame cap (~800ms). */
const SETTLE_STABLE_FRAMES = 3;
const SETTLE_MAX_FRAMES = 50;

/** Pad the target, then clamp so the spotlight ring never sits off-screen. */
function spotlightRect(raw: DOMRect): DOMRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(VIEWPORT_MARGIN, raw.left - ANCHOR_PAD);
  const top = Math.max(VIEWPORT_MARGIN, raw.top - ANCHOR_PAD);
  const right = Math.min(vw - VIEWPORT_MARGIN, raw.right + ANCHOR_PAD);
  const bottom = Math.min(vh - VIEWPORT_MARGIN, raw.bottom + ANCHOR_PAD);
  return new DOMRect(
    left,
    top,
    Math.max(0, right - left),
    Math.max(0, bottom - top),
  );
}

interface CardPosition {
  style: React.CSSProperties;
  /** Resolved placement (may differ from requested when clamped/centered). */
  placement: TourPlacement;
}

function computeCardPosition(
  rect: DOMRect | null,
  placement: TourPlacement,
): CardPosition {
  if (!rect || placement === "center") {
    return {
      placement: "center",
      style: {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      },
    };
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampLeft = (l: number) =>
    Math.max(12, Math.min(l, vw - CARD_WIDTH - 12));
  // Keep the card from riding off the top/bottom edge for side placements.
  const clampTop = (t: number) => Math.max(12, Math.min(t, vh - 220));

  switch (placement) {
    case "right":
      return {
        placement,
        style: {
          top: clampTop(rect.top),
          left: Math.min(rect.right + CARD_GAP, vw - CARD_WIDTH - 12),
        },
      };
    case "left":
      return {
        placement,
        style: {
          top: clampTop(rect.top),
          left: Math.max(12, rect.left - CARD_GAP - CARD_WIDTH),
        },
      };
    case "top":
      return {
        placement,
        style: {
          top: rect.top - CARD_GAP,
          left: clampLeft(rect.left),
          transform: "translateY(-100%)",
        },
      };
    case "bottom":
    default:
      return {
        placement: "bottom",
        style: {
          top: Math.min(rect.bottom + CARD_GAP, vh - 40),
          left: clampLeft(rect.left),
        },
      };
  }
}

export function TourOverlay() {
  const router = useRouter();
  const pathname = usePathname();

  const active = useTourStore((s) => s.active);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const mode = useTourStore((s) => s.mode);
  const paused = useTourStore((s) => s.paused);
  const hydrateSeen = useTourStore((s) => s.hydrateSeen);
  const stop = useTourStore((s) => s.stop);
  const next = useTourStore((s) => s.next);

  const stepDef = TOUR_STEPS[stepIndex];
  const isInteractiveStep =
    active && mode === "interactive" && Boolean(stepDef?.interactive);

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [anchorReady, setAnchorReady] = useState(false);

  const targetElRef = useRef<Element | null>(null);
  const enterRanForStep = useRef<number>(-1);

  // Hydrate the "already seen" flag once on the client (SSR-safe default true).
  useEffect(() => {
    hydrateSeen();
  }, [hydrateSeen]);

  // Reset the onEnter guard whenever the tour opens/closes so a re-run replays.
  useEffect(() => {
    if (!active) {
      enterRanForStep.current = -1;
      targetElRef.current = null;
      setRect(null);
      setAnchorReady(false);
    }
  }, [active]);

  // Escape closes the tour.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  const markFallback = useTourStore((s) => s.markFallback);

  // ── Step machine: navigate → onEnter → resolve anchor ────────────────────
  useEffect(() => {
    if (!active) return;
    const step = TOUR_STEPS[stepIndex];
    if (!step) return;

    // Reset before anything else so auto-advance can't fire on the previous
    // step's stale `anchorReady` while we navigate/resolve the new one.
    setAnchorReady(false);
    setRect(null);
    targetElRef.current = null;

    // 1. Get onto the right route first; this effect re-runs on pathname change.
    if (step.route && pathname !== step.route) {
      router.push(step.route);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let rafId: number | undefined;

    const ctx: TourContext = {
      router: { push: (href) => router.push(href) },
      mode,
      markFallback,
    };

    // Follow the element through any open/close or route-change animation and
    // only commit the halo once its rect stops moving — this is what stops the
    // spotlight from landing on a stale (mid-animation) position on Back/Next.
    const settleOn = (el: Element) => {
      targetElRef.current = el;
      try {
        // Domain radar / forecast / decision (and anything else below the fold
        // in the asset drawer) must scroll into the panel before we measure —
        // otherwise the ring frames a clipped, off-screen rect.
        el.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "auto",
        });
      } catch {
        /* older engines: measure in place */
      }
      let last = el.getBoundingClientRect();
      let stableFrames = 0;
      let frames = 0;
      const measure = () => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        const moved =
          Math.abs(r.top - last.top) > 0.5 ||
          Math.abs(r.left - last.left) > 0.5 ||
          Math.abs(r.width - last.width) > 0.5 ||
          Math.abs(r.height - last.height) > 0.5;
        last = r;
        stableFrames = moved ? 0 : stableFrames + 1;
        frames += 1;
        if (stableFrames >= SETTLE_STABLE_FRAMES || frames >= SETTLE_MAX_FRAMES) {
          setRect(r);
          setAnchorReady(true);
          return;
        }
        rafId = requestAnimationFrame(measure);
      };
      rafId = requestAnimationFrame(measure);
    };

    const resolveAnchor = () => {
      let tries = 0;
      const tick = () => {
        if (cancelled) return;
        const capped = tries >= POLL_MAX;
        // 1. Hold until the step's readiness gate passes (e.g. review settled).
        if (!capped && step.waitUntil && !step.waitUntil(useLiveStore.getState())) {
          tries += 1;
          pollTimer = setTimeout(tick, POLL_MS);
          return;
        }
        // 2. Centered act card — nothing to spotlight.
        if (!step.anchor) {
          setAnchorReady(true);
          return;
        }
        // 3. Wait for the anchor element, then settle the halo onto it.
        const el = document.querySelector(`[data-tour="${step.anchor}"]`);
        if (el) {
          settleOn(el);
          return;
        }
        if (capped) {
          // Anchor never showed — degrade to a centered card.
          setAnchorReady(true);
          return;
        }
        tries += 1;
        pollTimer = setTimeout(tick, POLL_MS);
      };
      tick();
    };

    void (async () => {
      if (enterRanForStep.current !== stepIndex) {
        enterRanForStep.current = stepIndex;
        try {
          await step.onEnter?.(ctx);
        } catch {
          /* onEnter is best-effort; the narration still stands */
        }
      }
      if (cancelled) return;
      resolveAnchor();
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [active, stepIndex, pathname, router, mode, markFallback]);

  // ── Keep the spotlight glued to the target while the step is shown ────────
  const remeasure = useCallback(() => {
    const el = targetElRef.current;
    if (el) setRect(el.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!active || !rect) return;
    const el = targetElRef.current;
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    let ro: ResizeObserver | undefined;
    if (el && "ResizeObserver" in window) {
      ro = new ResizeObserver(remeasure);
      ro.observe(el);
    }
    // Late layout shifts (panel/ancestor CSS transitions) don't fire resize or
    // ResizeObserver — catch them so the halo re-glues to the settled position.
    el?.addEventListener("transitionend", remeasure);
    return () => {
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
      el?.removeEventListener("transitionend", remeasure);
      ro?.disconnect();
    };
    // rect in deps so we re-bind if the target element swaps between steps.
  }, [active, rect, remeasure]);

  // ── Auto-advance once the spotlight has landed (auto/demo mode) ───────────
  useEffect(() => {
    if (!active || mode !== "auto" || paused || !anchorReady) return;
    const step = TOUR_STEPS[stepIndex];
    const dwell = step?.autoMs ?? DEFAULT_DWELL;
    const timer = setTimeout(() => next(), dwell);
    return () => clearTimeout(timer);
  }, [active, mode, paused, anchorReady, stepIndex, next]);

  // ── Interactive advance: the user performs the real gesture ───────────────
  // Only in interactive mode, and only after the spotlight has landed so a
  // stray earlier click can't skip ahead. `done` steps watch the store for the
  // resulting state change; gestures with no store signal advance on a click
  // inside the spotlit anchor.
  useEffect(() => {
    if (!active || mode !== "interactive" || !anchorReady) return;
    const step = TOUR_STEPS[stepIndex];
    const it = step?.interactive;
    if (!it) return;

    if (it.done) {
      // Subscribe (not check-now) so returning to this step via Back doesn't
      // instantly bounce forward on an already-satisfied predicate.
      return useLiveStore.subscribe((s) => {
        if (it.done!(s)) next();
      });
    }

    const onClick = (e: MouseEvent) => {
      const el = targetElRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) next();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, mode, anchorReady, stepIndex, next]);

  if (!active) {
    return <TourInvite />;
  }

  const step = TOUR_STEPS[stepIndex];
  if (!step) return null;

  const paddedRect = rect ? spotlightRect(rect) : null;
  const { style: cardStyle, placement } = computeCardPosition(
    paddedRect,
    step.anchor ? step.placement ?? "bottom" : "center",
  );

  return (
    <div
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-label="SOP Opera guided tour"
    >
      <Spotlight rect={paddedRect} interactive={isInteractiveStep} />
      <div
        className={styles.cardAnchor}
        style={{ ...cardStyle, width: CARD_WIDTH }}
        data-placement={placement}
      >
        <NarrationCard
          step={step}
          stepIndex={stepIndex}
          interactive={isInteractiveStep}
        />
      </div>
    </div>
  );
}
