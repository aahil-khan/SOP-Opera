"use client";

import { useDemoStatus } from "@/lib/useDemoStatus";
import styles from "./LiveFeedPill.module.css";

export function LiveFeedPill() {
  const { status } = useDemoStatus();

  if (!status?.ambient_running) return null;

  return (
    <span className={styles.pill} title="Ambient plant telemetry is streaming">
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>Live plant feed active</span>
    </span>
  );
}
