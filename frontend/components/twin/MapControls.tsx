"use client";

import styles from "./MapControls.module.css";

interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  shiftForDrawer?: boolean;
}

export function MapControls({
  onZoomIn,
  onZoomOut,
  onReset,
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
    </div>
  );
}
