"use client";

import styles from "./MapControls.module.css";

export type MapLayerId = "ops";

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onOverview?: () => void;
  /** When set, show an Ops layer toggle in this stack. */
  opsEnabled?: boolean;
  onToggleOps?: () => void;
  opsCount?: number;
  shiftForDrawer?: boolean;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onReset,
  onOverview,
  opsEnabled,
  onToggleOps,
  opsCount = 0,
  shiftForDrawer = false,
}: MapControlsProps) {
  const showOps = typeof onToggleOps === "function";

  return (
    <div
      className={styles.controls}
      data-shift={shiftForDrawer ? "true" : undefined}
      role="group"
      aria-label="Map controls"
    >
      <button
        type="button"
        className={styles.btn}
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnReset}`}
        onClick={onReset}
        aria-label="Reset view"
        title="Reset view"
      >
        <span>⤢</span>
      </button>
      {onOverview ? (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnOverview}`}
          onClick={onOverview}
          aria-label="All floors overview"
          title="All floors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <rect
              x="1.5"
              y="3"
              width="3.5"
              height="10"
              rx="0.8"
              fill="currentColor"
              opacity="0.9"
            />
            <rect
              x="6.25"
              y="3"
              width="3.5"
              height="10"
              rx="0.8"
              fill="currentColor"
              opacity="0.9"
            />
            <rect
              x="11"
              y="3"
              width="3.5"
              height="10"
              rx="0.8"
              fill="currentColor"
              opacity="0.9"
            />
          </svg>
        </button>
      ) : null}
      {showOps ? (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnOps}`}
          data-active={opsEnabled ? "true" : undefined}
          aria-pressed={opsEnabled}
          title={
            opsEnabled
              ? "Hide ops chips (permits, isolation, occupancy)"
              : "Show ops chips (permits, isolation, occupancy)"
          }
          onClick={onToggleOps}
        >
          <span className={styles.opsLabel}>Ops</span>
          {opsCount > 0 ? (
            <span className={styles.opsCount} aria-label={`${opsCount} assets`}>
              {opsCount}
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}
