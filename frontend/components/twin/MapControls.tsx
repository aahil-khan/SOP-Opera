"use client";

import styles from "./MapControls.module.css";

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onOverview?: () => void;
  legendOpen?: boolean;
  onToggleLegend?: () => void;
  shiftForDrawer?: boolean;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onReset,
  onOverview,
  legendOpen = false,
  onToggleLegend,
  shiftForDrawer = false,
}: MapControlsProps) {
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
      {onToggleLegend ? (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnLegend}`}
          data-active={legendOpen ? "true" : undefined}
          onClick={onToggleLegend}
          aria-label={legendOpen ? "Hide legend" : "Show legend"}
          aria-expanded={legendOpen}
          aria-controls="twin-legend"
          title="Legend"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <circle cx="3" cy="4" r="2" fill="var(--status-nominal)" />
            <circle cx="3" cy="8" r="2" fill="var(--status-elevated)" />
            <circle cx="3" cy="12" r="2" fill="var(--status-blocking)" />
            <rect
              x="7"
              y="3"
              width="7"
              height="2"
              rx="1"
              fill="currentColor"
              opacity="0.75"
            />
            <rect
              x="7"
              y="7"
              width="7"
              height="2"
              rx="1"
              fill="currentColor"
              opacity="0.75"
            />
            <rect
              x="7"
              y="11"
              width="5"
              height="2"
              rx="1"
              fill="currentColor"
              opacity="0.75"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
