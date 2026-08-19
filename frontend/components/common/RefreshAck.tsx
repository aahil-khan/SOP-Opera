"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./RefreshAck.module.css";

/**
 * Holds a "just refreshed" acknowledgement for a few seconds.
 *
 * Settings → Reload, Eval → Run now and AI Ops → Refresh all re-fetch
 * correctly, but when the response is identical to what is already on screen
 * nothing moves, so the control reads as dead. The acknowledgement reports that
 * the fetch completed, which is the fact the operator is missing — it does not
 * claim the data changed.
 */
export function useRefreshAck(holdMs = 2600): {
  acked: boolean;
  ack: () => void;
} {
  const [ackAt, setAckAt] = useState<number | null>(null);

  const ack = useCallback(() => setAckAt(Date.now()), []);

  useEffect(() => {
    if (ackAt == null) return;
    const t = window.setTimeout(() => setAckAt(null), holdMs);
    return () => window.clearTimeout(t);
  }, [ackAt, holdMs]);

  return { acked: ackAt != null, ack };
}

/**
 * Chip shown next to a refresh control once its fetch resolves.
 * `aria-live` announces it, so the confirmation is not sight-only.
 */
export function RefreshAck({
  shown,
  label = "Updated",
}: {
  shown: boolean;
  label?: string;
}) {
  return (
    <span className={styles.slot} role="status" aria-live="polite">
      {shown ? <span className={styles.chip}>{label}</span> : null}
    </span>
  );
}
