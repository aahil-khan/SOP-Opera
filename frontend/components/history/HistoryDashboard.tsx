"use client";

/**
 * Operating history (W11b) — the corpus read as a year rather than as a feed.
 *
 * Deliberately a scorecard you look at, not a surface you operate: it sits
 * alongside /eval and /ai-ops rather than on the operator twin, which is already
 * dense. One fetch backs all three panels.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchHistoryOverview, type HistoryOverview } from "@/lib/liveApi";
import { FactDistribution } from "./FactDistribution";
import { PatternDiscovery } from "./PatternDiscovery";
import { TopAuthorities } from "./TopAuthorities";
import { VerdictsByMonth } from "./VerdictsByMonth";
import styles from "./HistoryDashboard.module.css";

const WINDOWS = [3, 6, 12, 24] as const;

function spanLabel(from: string | null, to: string | null): string {
  if (!from || !to) return "no reviews yet";
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString("en", { month: "short", year: "numeric" });
  return `${fmt(from)} – ${fmt(to)}`;
}

export function HistoryDashboard() {
  const [months, setMonths] = useState<number>(12);
  const [data, setData] = useState<HistoryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    try {
      setData(await fetchHistoryOverview(window));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(months);
  }, [load, months]);

  const verdictTotals = data?.verdicts_by_month.reduce(
    (a, m) => ({
      nominal: a.nominal + m.nominal,
      elevated: a.elevated + m.elevated,
      blocking: a.blocking + m.blocking,
    }),
    { nominal: 0, elevated: 0, blocking: 0 },
  );
  const graded =
    (verdictTotals?.nominal ?? 0) +
    (verdictTotals?.elevated ?? 0) +
    (verdictTotals?.blocking ?? 0);

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Operating history</h1>
          <p className={styles.sub}>
            {data
              ? `${data.review_count} reviews · ${spanLabel(data.first_review_at, data.last_review_at)}`
              : " "}
          </p>
        </div>
        <div className={styles.windows} role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              className={styles.windowBtn}
              data-active={w === months}
              onClick={() => setMonths(w)}
            >
              {w}m
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          {error}
          <button type="button" className={styles.retry} onClick={() => void load(months)}>
            Retry
          </button>
        </p>
      )}

      {data && (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{data.review_count}</span>
              <span className={styles.statLabel}>Reviews</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>
                {graded > 0
                  ? `${Math.round(((verdictTotals?.nominal ?? 0) / graded) * 100)}%`
                  : "—"}
              </span>
              <span className={styles.statLabel}>Nominal</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{verdictTotals?.elevated ?? 0}</span>
              <span className={styles.statLabel}>Elevated</span>
            </div>
            <div className={styles.stat} data-emphasis="blocking">
              <span className={styles.statValue}>{verdictTotals?.blocking ?? 0}</span>
              <span className={styles.statLabel}>Blocking</span>
            </div>
          </div>

          <section className={styles.panel}>
            <h2 className={styles.panelTitle}>Verdicts by month</h2>
            <VerdictsByMonth data={data.verdicts_by_month} />
          </section>

          <div className={styles.split}>
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Which conditions fire</h2>
              <FactDistribution data={data.fact_distribution} />
            </section>
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Most-cited authorities</h2>
              <TopAuthorities data={data.top_authorities} />
            </section>
          </div>

          {/* Last, and full width: the three panels above describe the corpus,
              this one is what reading it produced. It carries its own heading
              and provenance chip, so it is not wrapped in styles.panel. */}
          <PatternDiscovery months={months} />
        </>
      )}

      {loading && !data && <p className={styles.loading}>Loading history…</p>}
    </div>
  );
}
