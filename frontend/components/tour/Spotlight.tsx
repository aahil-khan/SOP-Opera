"use client";

/**
 * The dim + spotlight. A full-viewport dim layer uses an evenodd clip-path
 * cutout (never clipped by overflow ancestors the way a 9999px box-shadow is).
 * A separate ring draws the accent border + glow around the revealed target.
 * When there is no target (centered act card) we dim everything.
 */

import styles from "./Spotlight.module.css";

interface SpotlightProps {
  /** Already padded in TourOverlay; null → full-screen dim, no cutout. */
  rect: DOMRect | null;
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

export function Spotlight({ rect }: SpotlightProps) {
  if (!rect) {
    return <div className={styles.fullDim} aria-hidden="true" />;
  }
  return (
    <>
      {/* Full-viewport hit target — clip-path on the dim would otherwise let
          clicks fall through the hole onto the page beneath. */}
      <div className={styles.blocker} aria-hidden="true" />
      <div
        className={styles.dim}
        aria-hidden="true"
        style={{ clipPath: holeClipPath(rect) }}
      />
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
    </>
  );
}
