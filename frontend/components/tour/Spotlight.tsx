"use client";

/**
 * The dim + spotlight. A full-viewport dim layer uses an evenodd clip-path
 * cutout (never clipped by overflow ancestors the way a 9999px box-shadow is).
 * A separate ring draws the accent border + glow around the revealed target.
 * When there is no target (centered act card) we dim everything.
 *
 * Two modalities:
 *  - Non-interactive (default): a full-screen transparent `.blocker` swallows all
 *    clicks, so the tour is modal and a stray click can't fight the step machine.
 *  - Interactive ("your turn" steps): four dim bands frame the cutout instead, so
 *    the spotlit region stays genuinely clickable. Wheel events on the bands are
 *    forwarded to `scrollport` so drawer bodies stay scrollable under the dim.
 */

import { useEffect, useRef } from "react";
import styles from "./Spotlight.module.css";

interface SpotlightProps {
  /** Already padded in TourOverlay; null → full-screen dim, no cutout. */
  rect: DOMRect | null;
  /** Leave the cutout clickable (the user is meant to act inside it). */
  interactive?: boolean;
  /** Scroll container under the bands (e.g. asset-panel body) — keeps wheel live. */
  scrollport?: HTMLElement | null;
}

/** Corner radius kept in sync with `.ring` in the CSS module. */
const HOLE_RADIUS = 8;

function holeClipPath(rect: DOMRect): string {
  // evenodd: outer viewport rectangle minus the hole. Using % for the outer
  // path keeps it tied to the fixed overlay; px for the hole track the target.
  const { left: l, top: t, right: r, bottom: b } = rect;
  return `polygon(
    evenodd,
    0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
    ${l}px ${t}px,
    ${l}px ${b}px,
    ${r}px ${b}px,
    ${r}px ${t}px,
    ${l}px ${t}px
  )`;
}

export function Spotlight({
  rect,
  interactive = false,
  scrollport = null,
}: SpotlightProps) {
  const bandRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Bands swallow pointer events (so clicks don't leak). Forward wheel to the
  // target's scrollport so the Vessel A panel body stays scrollable.
  useEffect(() => {
    if (!interactive || !scrollport) return;
    const bands = bandRefs.current.filter(Boolean) as HTMLDivElement[];
    if (bands.length === 0) return;

    const onWheel = (e: WheelEvent) => {
      scrollport.scrollBy({ top: e.deltaY, left: e.deltaX });
      e.preventDefault();
      e.stopPropagation();
    };

    for (const band of bands) {
      band.addEventListener("wheel", onWheel, { passive: false });
    }
    return () => {
      for (const band of bands) {
        band.removeEventListener("wheel", onWheel);
      }
    };
  }, [interactive, scrollport, rect?.top, rect?.left, rect?.width, rect?.height]);

  if (!rect) {
    return <div className={styles.fullDim} aria-hidden="true" />;
  }

  const dim = (
    <div
      className={styles.dim}
      aria-hidden="true"
      style={{ clipPath: holeClipPath(rect) }}
    />
  );

  const ring = (
    <div
      className={styles.ring}
      aria-hidden="true"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        borderRadius: HOLE_RADIUS,
      }}
    />
  );

  if (interactive) {
    // Four click-catching bands around the cutout; the center gap passes clicks
    // through to the real element underneath. Dim stays visual-only.
    const setBand = (i: number) => (node: HTMLDivElement | null) => {
      bandRefs.current[i] = node;
    };
    return (
      <>
        {dim}
        <div
          ref={setBand(0)}
          className={styles.band}
          aria-hidden="true"
          style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }}
        />
        <div
          ref={setBand(1)}
          className={styles.band}
          aria-hidden="true"
          style={{ top: rect.bottom, left: 0, right: 0, bottom: 0 }}
        />
        <div
          ref={setBand(2)}
          className={styles.band}
          aria-hidden="true"
          style={{
            top: rect.top,
            height: rect.height,
            left: 0,
            width: Math.max(0, rect.left),
          }}
        />
        <div
          ref={setBand(3)}
          className={styles.band}
          aria-hidden="true"
          style={{
            top: rect.top,
            height: rect.height,
            left: rect.right,
            right: 0,
          }}
        />
        {ring}
      </>
    );
  }

  return (
    <>
      {/* Full-viewport hit target — clip-path on the dim would otherwise let
          clicks fall through the hole onto the page beneath. */}
      <div className={styles.blocker} aria-hidden="true" />
      {dim}
      {ring}
    </>
  );
}
