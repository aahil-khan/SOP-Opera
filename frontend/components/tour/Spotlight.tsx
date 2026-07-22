"use client";

/**
 * The dim + spotlight. Uses the box-shadow-halo trick: a single element sized to
 * the target casts a giant spread shadow that dims the whole viewport *except*
 * the cutout. When there is no target (centered act card) we dim everything.
 *
 * Two modalities:
 *  - Non-interactive (default): a full-screen transparent `.blocker` swallows all
 *    clicks, so the tour is modal and a stray click can't fight the step machine.
 *  - Interactive ("your turn" steps): four dim bands frame the cutout instead, so
 *    the spotlit region stays genuinely clickable and the user performs the real
 *    gesture on the actual UI. The halo itself never intercepts clicks.
 */

import styles from "./Spotlight.module.css";

interface SpotlightProps {
  /** Already padded in TourOverlay; null → full-screen dim, no cutout. */
  rect: DOMRect | null;
  /** Leave the cutout clickable (the user is meant to act inside it). */
  interactive?: boolean;
}

export function Spotlight({ rect, interactive = false }: SpotlightProps) {
  if (!rect) {
    return <div className={styles.fullDim} aria-hidden="true" />;
  }

  const halo = (
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
  );

  if (interactive) {
    // Four click-catching bands around the cutout; the center gap passes clicks
    // through to the real element underneath. Dimming comes from the halo's
    // box-shadow, so the bands themselves stay transparent.
    return (
      <>
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
          style={{ top: rect.top, height: rect.height, left: rect.right, right: 0 }}
        />
        {halo}
      </>
    );
  }

  return (
    <>
      {/* Transparent full-screen layer that makes the tour modal — the halo's
          box-shadow only paints the dim, it does not intercept clicks. */}
      <div className={styles.blocker} aria-hidden="true" />
      {halo}
    </>
  );
}
