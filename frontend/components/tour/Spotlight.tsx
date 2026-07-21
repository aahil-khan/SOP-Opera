"use client";

/**
 * The dim + spotlight. Uses the box-shadow-halo trick: a single element sized to
 * the target casts a giant spread shadow that dims the whole viewport *except*
 * the cutout. When there is no target (centered act card) we dim everything.
 */

import styles from "./Spotlight.module.css";

interface SpotlightProps {
  /** Already padded in TourOverlay; null → full-screen dim, no cutout. */
  rect: DOMRect | null;
}

export function Spotlight({ rect }: SpotlightProps) {
  if (!rect) {
    return <div className={styles.fullDim} aria-hidden="true" />;
  }
  return (
    <>
      {/* Transparent full-screen layer that makes the tour modal — the halo's
          box-shadow only paints the dim, it does not intercept clicks. */}
      <div className={styles.blocker} aria-hidden="true" />
      <div
        className={styles.hole}
        aria-hidden="true"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        }}
      />
    </>
  );
}
