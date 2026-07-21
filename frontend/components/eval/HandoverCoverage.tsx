"use client";

import { useEffect, useState } from "react";
import { fetchHandoverMetrics } from "@/lib/liveApi";
import type { HandoverMetrics } from "@/shared/schemas";
import styles from "./HandoverCoverage.module.css";

/**
 * Handover coverage — an operational measure of the handover process.
 *
 * This is deliberately its own panel, computed in the handover domain and NOT
 * wired into eval/detectors.py. Making a missed acknowledgement a scored
 * detector input would need a ground-truth criterion first, or the
 * compound-vs-single-sensor confusion matrices become circular (see CLAUDE.md).
 * So it sits beside those numbers, not inside them.
 */
export function HandoverCoverage() {
  const [metrics, setMetrics] = useState<HandoverMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchHandoverMetrics()
      .then(setMetrics)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Shift handover coverage</h2>
          <p className={styles.subtitle}>
            How reliably hazards carried across a shift boundary are acknowledged
            before the incoming operator takes custody. Operational — not a
            detector input.
          </p>
        </div>
      </header>

      {error && <p className="text-error">{error}</p>}

      {metrics && (
        <>
          <div className={styles.stats}>
            <Stat
              tone={metrics.coverage_pct >= 100 ? "success" : "warn"}
              value={`${metrics.coverage_pct.toFixed(0)}%`}
              label="High-risk items acknowledged"
            />
            <Stat
              value={
                metrics.median_ack_minutes == null
                  ? "—"
                  : `${Math.round(metrics.median_ack_minutes)} min`
              }
              label="Median time to acknowledge"
            />
            <Stat
              tone={metrics.unacknowledged_crossings > 0 ? "bad" : "success"}
              value={String(metrics.unacknowledged_crossings)}
              label="Hazards crossed unacknowledged"
            />
          </div>
          <p className={styles.footnote}>
            {metrics.required_items_cleared} of {metrics.required_items_total}{" "}
            required items cleared across {metrics.handovers_total} issued
            handover{metrics.handovers_total === 1 ? "" : "s"} (
            {metrics.handovers_accepted} accepted). An unacknowledged crossing is
            what the assessment surfaces as{" "}
            <code className={styles.code}>unacknowledged_handover</code>.
          </p>
        </>
      )}

      {!metrics && !error && (
        <p className={styles.loading}>Loading handover metrics…</p>
      )}
    </section>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "success" | "warn" | "bad";
}) {
  return (
    <div className={styles.stat} data-tone={tone}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
