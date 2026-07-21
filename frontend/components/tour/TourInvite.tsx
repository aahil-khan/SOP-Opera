"use client";

/**
 * Non-blocking first-visit nudge. Shows a small chip on the operator dashboard
 * only until the user has seen (started or dismissed) the tour once — the seen
 * flag lives in tourStore, backed by localStorage.
 */

import { usePathname } from "next/navigation";
import { useState } from "react";
import { useTourStore } from "@/lib/tourStore";
import styles from "./TourInvite.module.css";

export function TourInvite() {
  const pathname = usePathname();
  const hasSeen = useTourStore((s) => s.hasSeen);
  const start = useTourStore((s) => s.start);
  const markSeen = useTourStore((s) => s.markSeen);
  const [dismissed, setDismissed] = useState(false);

  // Only greet a genuinely new operator, and only on the home surface.
  if (hasSeen || dismissed || pathname !== "/operator") return null;

  return (
    <div className={styles.chip} role="note">
      <span className={styles.mask} aria-hidden="true">
        🎭
      </span>
      <div className={styles.copy}>
        <strong className={styles.title}>New here?</strong>
        <span className={styles.sub}>Take the 90-second tour of the plant.</span>
      </div>
      <button
        type="button"
        className={styles.start}
        onClick={() => start("interactive")}
      >
        Start
      </button>
      <button
        type="button"
        className={styles.close}
        aria-label="Dismiss"
        onClick={() => {
          markSeen();
          setDismissed(true);
        }}
      >
        ✕
      </button>
    </div>
  );
}
