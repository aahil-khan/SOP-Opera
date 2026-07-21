"use client";

import { useEffect, useState } from "react";
import { m, useReducedMotion } from "framer-motion";
import { SectionShell } from "./SectionShell";
import { CountUp } from "./CountUp";
import { fetchEvalSummary, type EvalSummary } from "@/lib/liveApi";
import { EASE_OUT, viewportOnce } from "@/lib/motion";
import styles from "./ProofSection.module.css";

/**
 * Reads the live harness at GET /api/eval/summary rather than hardcoding
 * figures — the numbers on this page are whatever the detectors currently
 * score, so fixing backend/app/eval/ corrects the landing automatically.
 *
 * The backend may not be running when someone opens this page, so every state
 * (loading, error, offline) degrades to a calm skeleton instead of an error.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; data: EvalSummary }
  | { status: "unavailable" };

const DETECTOR_META = [
  {
    key: "single_sensor" as const,
    name: "Single-sensor baseline",
    note: "One reading, one threshold — today's alarm philosophy.",
  },
  {
    key: "forecast" as const,
    name: "Predictive trend",
    note: "Extrapolates where a reading is heading.",
  },
  {
    key: "compound" as const,
    name: "Compound engine",
    note: "Correlates readings, permits, isolation and people.",
  },
];

function pct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function ProofSection() {
  const reduced = useReducedMotion() ?? false;
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void fetchEvalSummary()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = state.status === "ready" ? state.data : null;

  return (
    <SectionShell
      id="proof"
      tone="panel"
      label="The proof"
      title="Measured against the alarm philosophy it replaces."
      lede="A labeled case set runs through three detectors on every build. The metric that matters is the false-negative rate — the dangerous situations a detector fails to flag at all."
    >
      <div className={styles.grid}>
        {DETECTOR_META.map((meta, i) => {
          const d = data?.[meta.key];
          const fnRate = d ? pct(d.false_negative_rate * 100) : 0;
          const isCompound = meta.key === "compound";

          return (
            <m.article
              key={meta.key}
              className={styles.card}
              data-emphasis={isCompound}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={{
                duration: 0.45,
                ease: EASE_OUT,
                delay: reduced ? 0 : i * 0.1,
              }}
            >
              <header className={styles.cardHead}>
                <span className={styles.cardName}>{meta.name}</span>
                {isCompound ? (
                  <span className="badge" data-risk="nominal">
                    Ours
                  </span>
                ) : null}
              </header>

              <div className={styles.metric}>
                <span className={styles.metricValue} data-emphasis={isCompound}>
                  {d ? (
                    <>
                      <CountUp to={fnRate} decimals={1} />%
                    </>
                  ) : (
                    <span className={styles.pending}>—</span>
                  )}
                </span>
                <span className={styles.metricLabel}>
                  False negatives missed
                </span>
              </div>

              <div className={styles.bar} aria-hidden="true">
                <m.span
                  className={styles.barFill}
                  data-emphasis={isCompound}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: d ? fnRate / 100 : 0 }}
                  viewport={viewportOnce}
                  transition={{
                    duration: reduced ? 0 : 0.9,
                    ease: EASE_OUT,
                    delay: reduced ? 0 : 0.2 + i * 0.1,
                  }}
                />
              </div>

              <dl className={styles.subMetrics}>
                <div>
                  <dt>Recall</dt>
                  <dd>{d ? `${(d.recall * 100).toFixed(1)}%` : "—"}</dd>
                </div>
                <div>
                  <dt>Precision</dt>
                  <dd>{d ? `${(d.precision * 100).toFixed(1)}%` : "—"}</dd>
                </div>
              </dl>

              <p className={styles.cardNote}>{meta.note}</p>
            </m.article>
          );
        })}
      </div>

      <div className={styles.footRow}>
        <div className={styles.foot}>
          <span className={styles.footValue}>
            {data?.hero_lead_time_minutes != null ? (
              <>
                <CountUp to={data.hero_lead_time_minutes} decimals={0} /> min
              </>
            ) : (
              "—"
            )}
          </span>
          <span className={styles.footLabel}>
            Lead time before the single-sensor threshold is crossed
          </span>
        </div>
        <div className={styles.foot}>
          <span className={styles.footValue}>
            {data ? <CountUp to={data.compound_only_catch_count} /> : "—"}
          </span>
          <span className={styles.footLabel}>
            Cases caught by correlation that no single sensor flagged
          </span>
        </div>
        <div className={styles.foot}>
          <span className={styles.footValue}>
            {data ? <CountUp to={data.case_count} /> : "—"}
          </span>
          <span className={styles.footLabel}>Labeled cases in the set</span>
        </div>
      </div>

      <p className={styles.source}>
        {state.status === "unavailable"
          ? "Live metrics unavailable — start the API to populate this section."
          : "Live from the evaluation harness · GET /api/eval/summary"}
      </p>
    </SectionShell>
  );
}
