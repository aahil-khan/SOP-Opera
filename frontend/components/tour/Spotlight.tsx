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
 *    the spotlit region stays genuinely clickable and the user performs the real
 *    gesture on the actual UI. The ring itself never intercepts clicks.
 */

import styles from "./Spotlight.module.css";

interface SpotlightProps {
  /** Already padded in TourOverlay; null → full-screen dim, no cutout. */
  rect: DOMRect | null;
  /** Leave the cutout clickable (the user is meant to act inside it). */
  interactive?: boolean;
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

export function Spotlight({ rect, interactive = false }: SpotlightProps) {
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
    return (
      <>
        {dim}
        <div
          className={styles.band}
          aria-hidden="true"
          style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }}
        />
        <div
          className={styles.band}
          aria-hidden="true"
          style={{ top: rect.bottom, left: 0, right: 0, bottom: 0 }}
        />
        <div
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
