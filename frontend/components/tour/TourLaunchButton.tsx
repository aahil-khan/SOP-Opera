"use client";

/** Toolbar entry point for the Grand Tour. Starts interactive; viewers can flip
 *  to auto-play from the tour controls. Hidden while the tour is already open. */

import { useTourStore } from "@/lib/tourStore";
import styles from "./TourLaunchButton.module.css";

export function TourLaunchButton() {
  const active = useTourStore((s) => s.active);
  const start = useTourStore((s) => s.start);

  if (active) return null;

  return (
    <button
      type="button"
      className={styles.button}
      onClick={() => start("interactive")}
      title="Take the guided tour"
    >
      <span aria-hidden="true">🎭</span>
      <span className={styles.label}>Tour</span>
    </button>
  );
}
