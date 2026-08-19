"use client";

/**
 * The Grand Tour overlay + step engine.
 *
 * Mounted once (beside AppToaster in app/layout.tsx) so it survives route
 * changes between acts. When the tour is inactive it renders only the tiny
 * first-visit invite — a single boolean subscription, no cost on the hot twin.
 *
 * Per active step the engine: (1) navigates to step.route if needed, (2) runs
 * step.onEnter once (drives liveStore / starts the real scenario), (3) resolves
 * the `data-tour` anchor and spotlights it — timing out to a centered "act
 * card" if it never appears, and (4) in auto mode, dwells then advances once
 * the spotlight has landed.
 *
 * Performance notes (the tour felt laggy start→finish):
 *  - waitUntil wakes on liveStore subscribe instead of a 100ms poll
 *  - DOM anchors are hunted on rAF, not setTimeout
 *  - remeasure is rAF-coalesced so scroll/resize don't thrash React
 *  - chrome stays unmounted until ready (no stale-rect flash) but ready is fast
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DWELL,
  TOUR_STEPS,
  type TourContext,
  type TourPlacement,
  type TourStep,
} from "@/lib/tourScript";
import { useLiveStore } from "@/lib/liveStore";
import { useTourStore } from "@/lib/tourStore";
import { NarrationCard } from "./NarrationCard";
import { Spotlight } from "./Spotlight";
import { TourInvite } from "./TourInvite";
import styles from "./TourOverlay.module.css";

/** Breathing room (px) around the spotlit element and between it and the card. */
const ANCHOR_PAD = 8;
/** Extra lift above the target so the ring clears page headings. */
const ANCHOR_PAD_TOP = 22;
/** Keep the ring fully on-screen — edge-flush targets used to clip the halo. */
const VIEWPORT_MARGIN = 12;
/** Halo box-shadow bleed that can paint outside the ring box into the nav. */
const RING_BLEED = 10;
const CARD_GAP = 16;
const CARD_WIDTH = 360;
/** rAF frames to hunt a missing anchor before degrading (~2s at 60fps). */
const ANCHOR_RAF_MAX = 120;
/** After waitUntil, brief retries for optional surfaces before skipping. */
const AVAILABLE_TRIES = 5;
const AVAILABLE_RETRY_MS = 80;
/** Hard cap for waitUntil / availableWhen (~5s). */
const GATE_MS = 5_000;

let cachedNavHeight = 48;

function readNavHeight(): number {
  if (typeof window === "undefined") return cachedNavHeight;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--nav-height")
    .trim();
  const n = Number.parseFloat(raw);
  if (Number.isFinite(n)) cachedNavHeight = n;
  return cachedNavHeight;
}

/** Content below the chrome — spotlight/card must not invade the top nav. */
function contentTopMin(): number {
  return readNavHeight() + VIEWPORT_MARGIN;
}

/**
 * Nearest scrollport ancestor (e.g. the asset-panel body). Used so the halo
 * never cuts through fixed drawer chrome like the Vessel A header/footer, and
 * so interactive bands can forward wheel events into it.
 */
function nearestScrollportEl(el: Element | null): HTMLElement | null {
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const oy = style.overflowY;
    const ox = style.overflowX;
    if (
      oy === "auto" ||
      oy === "scroll" ||
      oy === "overlay" ||
      ox === "auto" ||
      ox === "scroll" ||
      ox === "overlay"
    ) {
      return node as HTMLElement;
    }
    node = node.parentElement;
  }
  return null;
}

/** Pad the target, then clamp inside the viewport *and* its scrollport so the
 *  ring/glow never invade the top nav or drawer chrome (Vessel A header, etc.). */
function spotlightRect(raw: DOMRect, target: Element | null): DOMRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Keep topMin at the content floor only — adding RING_BLEED here used to
  // push the hole down into page headings on full-page tour targets.
  let topMin = contentTopMin();
  let bottomMax = vh - VIEWPORT_MARGIN - RING_BLEED;
  let leftMin = VIEWPORT_MARGIN;
  let rightMax = vw - VIEWPORT_MARGIN;

  const port = nearestScrollportEl(target)?.getBoundingClientRect();
  if (port) {
    topMin = Math.max(topMin, port.top + VIEWPORT_MARGIN);
    bottomMax = Math.min(bottomMax, port.bottom - VIEWPORT_MARGIN - RING_BLEED);
    leftMin = Math.max(leftMin, port.left + VIEWPORT_MARGIN);
    rightMax = Math.min(rightMax, port.right - VIEWPORT_MARGIN);
  }

  const left = Math.max(leftMin, raw.left - ANCHOR_PAD);
  const top = Math.max(topMin, raw.top - ANCHOR_PAD_TOP);
  const right = Math.min(rightMax, raw.right + ANCHOR_PAD);
  const bottom = Math.min(bottomMax, raw.bottom + ANCHOR_PAD);
  return new DOMRect(
    left,
    top,
    Math.max(0, right - left),
    Math.max(0, bottom - top),
  );
}

/** Keep the narration card fully on-screen below the nav. */
const CARD_HEIGHT_FALLBACK = 320;

interface CardPosition {
  style: React.CSSProperties;
  /** Resolved placement (may differ from requested when clamped/centered). */
  placement: TourPlacement;
}

function computeCardPosition(
  rect: DOMRect | null,
  placement: TourPlacement,
): CardPosition {
  // Corner docks bottom-right regardless of target — full-page showcases
  // (report / handover / eval / ai-ops) must not cover headings or hero data.
  if (placement === "corner") {
    return {
      placement: "corner",
      style: {
        top: "auto",
        left: "auto",
        bottom: VIEWPORT_MARGIN,
        right: VIEWPORT_MARGIN,
      },
    };
  }

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
  const topMin = contentTopMin();
  const bottomMax = vh - VIEWPORT_MARGIN;
  const clampLeft = (l: number) =>
    Math.max(VIEWPORT_MARGIN, Math.min(l, vw - CARD_WIDTH - VIEWPORT_MARGIN));
  const clampTop = (t: number) =>
    Math.max(topMin, Math.min(t, bottomMax - CARD_HEIGHT_FALLBACK));

  switch (placement) {
    case "right":
      return {
        placement,
        style: {
          top: clampTop(rect.top),
          left: Math.min(
            rect.right + CARD_GAP,
            vw - CARD_WIDTH - VIEWPORT_MARGIN,
          ),
        },
      };
    case "left":
      return {
        placement,
        style: {
          top: clampTop(rect.top),
          left: Math.max(
            VIEWPORT_MARGIN,
            rect.left - CARD_GAP - CARD_WIDTH,
          ),
        },
      };
    case "top": {
      const desiredBottom = Math.max(
        topMin + CARD_HEIGHT_FALLBACK,
        rect.top - CARD_GAP,
      );
      return {
        placement,
        style: {
          top: clampTop(desiredBottom - CARD_HEIGHT_FALLBACK),
          left: clampLeft(rect.left),
        },
      };
    }
    case "bottom":
    default:
      return {
        placement: "bottom",
        style: {
          top: clampTop(
            Math.min(rect.bottom + CARD_GAP, bottomMax - CARD_HEIGHT_FALLBACK),
          ),
          left: clampLeft(rect.left),
        },
      };
  }
}

/** Resolve when `pred` is true, or after `ms`, whichever first. */
function whenTrue(
  pred: () => boolean,
  ms: number,
  isCancelled: () => boolean,
): Promise<boolean> {
  if (pred()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      resolve(ok);
    };
    const unsub = useLiveStore.subscribe(() => {
      if (isCancelled()) {
        finish(false);
        return;
      }
      if (pred()) finish(true);
    });
    const timer = setTimeout(() => finish(pred()), ms);
  });
}

function prefetchTourRoutes(
  router: { prefetch: (href: string) => void },
  fromIndex: number,
) {
  for (let i = fromIndex; i < Math.min(fromIndex + 4, TOUR_STEPS.length); i++) {
    const route = TOUR_STEPS[i]?.route;
    if (route) {
      try {
        router.prefetch(route);
      } catch {
        /* best-effort */
      }
    }
  }
}

export function TourOverlay() {
  const router = useRouter();
  const pathname = usePathname();

  const active = useTourStore((s) => s.active);
  const stepIndex = useTourStore((s) => s.stepIndex);
  const mode = useTourStore((s) => s.mode);
  const paused = useTourStore((s) => s.paused);
  const generation = useTourStore((s) => s.generation);
  const hydrateSeen = useTourStore((s) => s.hydrateSeen);
  const stop = useTourStore((s) => s.stop);
  const next = useTourStore((s) => s.next);
  const markFallback = useTourStore((s) => s.markFallback);

  const stepDef = TOUR_STEPS[stepIndex];
  const isInteractiveStep =
    active && mode === "interactive" && Boolean(stepDef?.interactive);

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [anchorReady, setAnchorReady] = useState(false);

  const targetElRef = useRef<Element | null>(null);
  const scrollportRef = useRef<HTMLElement | null>(null);
  const enterRanForStep = useRef<number>(-1);
  const remeasureRaf = useRef<number | undefined>(undefined);

  // Drop chrome synchronously when the step, route, or restart generation
  // changes — clearing only in an effect paints one frame of stale geometry.
  const settleKey = active ? `${generation}:${stepIndex}:${pathname}` : "off";
  const [prevSettleKey, setPrevSettleKey] = useState(settleKey);
  if (settleKey !== prevSettleKey) {
    setPrevSettleKey(settleKey);
    targetElRef.current = null;
    scrollportRef.current = null;
    setRect(null);
    setAnchorReady(false);
  }

  useEffect(() => {
    hydrateSeen();
  }, [hydrateSeen]);

  useEffect(() => {
    enterRanForStep.current = -1;
    if (!active) {
      targetElRef.current = null;
      scrollportRef.current = null;
      setRect(null);
      setAnchorReady(false);
    }
  }, [active, generation]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stop]);

  // ── Step machine: navigate → onEnter → resolve anchor ────────────────────
  useEffect(() => {
    if (!active) return;
    const step: TourStep | undefined = TOUR_STEPS[stepIndex];
    if (!step) return;

    if (
      step.route &&
      pathname !== step.route &&
      !pathname.startsWith(`${step.route}/`)
    ) {
      router.push(step.route);
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let rafId: number | undefined;

    const ctx: TourContext = {
      router: {
        push: (href) => router.push(href),
        prefetch: (href) => {
          try {
            router.prefetch(href);
          } catch {
            /* prefetch is best-effort */
          }
        },
      },
      mode,
      markFallback,
    };

    const revealOn = (el: Element) => {
      targetElRef.current = el;
      scrollportRef.current = nearestScrollportEl(el);
      try {
        el.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "auto",
        });
      } catch {
        /* measure in place */
      }
      // Measure this frame; one rAF catch-up for post-scroll layout.
      setRect(el.getBoundingClientRect());
      setAnchorReady(true);
      rafId = requestAnimationFrame(() => {
        if (cancelled || targetElRef.current !== el) return;
        setRect(el.getBoundingClientRect());
      });
    };

    const huntAnchor = (anchor: string) => {
      let frames = 0;
      const tick = () => {
        if (cancelled) return;
        const el = document.querySelector(`[data-tour="${anchor}"]`);
        if (el) {
          revealOn(el);
          return;
        }
        frames += 1;
        if (frames >= ANCHOR_RAF_MAX) {
          setAnchorReady(true);
          return;
        }
        rafId = requestAnimationFrame(tick);
      };
      tick();
    };

    const resolveAnchor = async () => {
      if (cancelled) return;

      if (step.waitUntil) {
        await whenTrue(
          () => step.waitUntil!(useLiveStore.getState()),
          GATE_MS,
          isCancelled,
        );
        if (cancelled) return;
      }

      if (step.availableWhen) {
        let tries = 0;
        while (
          !cancelled &&
          !step.availableWhen(useLiveStore.getState()) &&
          tries < AVAILABLE_TRIES
        ) {
          tries += 1;
          await new Promise<void>((r) => {
            pollTimer = setTimeout(r, AVAILABLE_RETRY_MS);
          });
        }
        if (cancelled) return;
        if (!step.availableWhen(useLiveStore.getState())) {
          next();
          return;
        }
      }

      if (!step.anchor) {
        setAnchorReady(true);
        return;
      }

      const existing = document.querySelector(`[data-tour="${step.anchor}"]`);
      if (existing) {
        revealOn(existing);
        return;
      }
      huntAnchor(step.anchor);
    };

    void (async () => {
      prefetchTourRoutes(router, stepIndex + 1);

      if (enterRanForStep.current !== stepIndex) {
        enterRanForStep.current = stepIndex;
        const run = Promise.resolve()
          .then(() => step.onEnter?.(ctx))
          .catch(() => {
            /* onEnter is best-effort */
          });
        if (step.awaitEnter) {
          await run;
          if (cancelled) return;
          await resolveAnchor();
          return;
        }
        void run;
      } else if (step.awaitEnter) {
        await resolveAnchor();
        return;
      }
      if (!step.awaitEnter) await resolveAnchor();
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
    };
  }, [active, stepIndex, pathname, router, mode, markFallback, generation, next]);

  // ── Keep the spotlight glued — rAF-coalesce so scroll doesn't thrash ──────
  const remeasure = useCallback(() => {
    if (remeasureRaf.current != null) return;
    remeasureRaf.current = requestAnimationFrame(() => {
      remeasureRaf.current = undefined;
      const el = targetElRef.current;
      if (!el) return;
      const nextRect = el.getBoundingClientRect();
      setRect((prev) => {
        if (
          prev &&
          Math.abs(prev.top - nextRect.top) < 0.5 &&
          Math.abs(prev.left - nextRect.left) < 0.5 &&
          Math.abs(prev.width - nextRect.width) < 0.5 &&
          Math.abs(prev.height - nextRect.height) < 0.5
        ) {
          return prev;
        }
        return nextRect;
      });
    });
  }, []);

  useEffect(() => {
    if (!active || !rect) return;
    const el = targetElRef.current;
    const port = scrollportRef.current ?? nearestScrollportEl(el);
    scrollportRef.current = port;
    window.addEventListener("scroll", remeasure, true);
    window.addEventListener("resize", remeasure);
    port?.addEventListener("scroll", remeasure, { passive: true });
    let ro: ResizeObserver | undefined;
    if (el && "ResizeObserver" in window) {
      ro = new ResizeObserver(remeasure);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener("scroll", remeasure, true);
      window.removeEventListener("resize", remeasure);
      port?.removeEventListener("scroll", remeasure);
      ro?.disconnect();
      if (remeasureRaf.current != null) {
        cancelAnimationFrame(remeasureRaf.current);
        remeasureRaf.current = undefined;
      }
    };
  }, [active, rect, remeasure]);

  // holdNextUntil: subscribe only when the step needs it (avoids getLiveAssetViews
  // on every store tick for steps without a hold gate).
  const holdNextReady = useLiveStore((s) => {
    const step = TOUR_STEPS[stepIndex];
    if (!step?.holdNextUntil) return true;
    return step.holdNextUntil(s);
  });

  useEffect(() => {
    if (!active || mode !== "auto" || paused || !anchorReady || !holdNextReady) {
      return;
    }
    const step = TOUR_STEPS[stepIndex];
    const dwell = step?.autoMs ?? DEFAULT_DWELL;
    const timer = setTimeout(() => next(), dwell);
    return () => clearTimeout(timer);
  }, [active, mode, paused, anchorReady, holdNextReady, stepIndex, next]);

  useEffect(() => {
    if (!active || mode !== "interactive" || !anchorReady) return;
    const step = TOUR_STEPS[stepIndex];
    const it = step?.interactive;
    if (!it) return;

    if (it.done) {
      return useLiveStore.subscribe((s) => {
        if (it.done!(s)) next();
      });
    }

    if (it.advanceOnClick === false) return;

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

  if (!anchorReady) {
    return (
      <div
        className={styles.root}
        role="dialog"
        aria-modal="true"
        aria-label="SOP Opera guided tour"
        aria-busy="true"
      />
    );
  }

  const paddedRect = rect ? spotlightRect(rect, targetElRef.current) : null;
  const scrollport = scrollportRef.current;
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
      <Spotlight
        rect={paddedRect}
        interactive={isInteractiveStep}
        scrollport={isInteractiveStep ? scrollport : null}
      />
      <div
        className={styles.cardAnchor}
        style={{ ...cardStyle, width: CARD_WIDTH }}
        data-placement={placement}
      >
        <NarrationCard
          step={step}
          stepIndex={stepIndex}
          interactive={isInteractiveStep}
          awaitingGesture={Boolean(
            isInteractiveStep &&
              step.interactive &&
              (step.interactive.done ||
                step.interactive.advanceOnClick !== false),
          )}
        />
      </div>
    </div>
  );
}
