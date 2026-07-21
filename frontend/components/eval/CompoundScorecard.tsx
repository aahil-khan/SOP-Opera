"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchEvalSummary, type EvalSummary } from "@/lib/liveApi";
import styles from "./CompoundScorecard.module.css";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** Lead time is plant process time, so it reads in minutes. */
function fmtLead(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  return `${Math.round(minutes)} min`;
}

/** Full page scorecard for /eval. */
export function EvalScorecardView() {
  const [summary, setSummary] = useState<EvalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEvalSummary();
      setSummary(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tForecast = summary?.hero_t_forecast_minutes ?? null;
  const tCompound = summary?.hero_t_compound_minutes ?? null;
  const tCritical = summary?.hero_t_single_sensor_minutes ?? null;
  const span =
    tCritical != null && tCritical > 0 ? tCritical : 34;

  function laneWidth(at: number | null): string {
    if (at == null || span <= 0) return "0%";
    return `${Math.min(100, Math.max(0, (at / span) * 100))}%`;
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headerText}>
          <h1 className={styles.pageTitle}>Compound vs single-sensor</h1>
          <p className={styles.pageSubtitle}>
            False negatives on plant states where a statutory provision requires
            stopping work. Labels come from the regulations, not from our
            detector.
          </p>
        </div>
        <button
          type="button"
          className={`btn ${styles.refresh}`}
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "Running…" : "Re-run"}
        </button>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {summary && (
        <>
          <div className={styles.heroStats} aria-label="Key metrics">
            {/* Raw counts, not the FN-reduction ratio. That ratio is pinned at
                100% whenever compound FN is zero, so it restates one number
                rather than adding one — and a bare "100%" reads as a red flag.
                It stays available as a column in the comparison table. */}
            <div className={styles.heroStat} data-tone="success">
              <span className={styles.heroValue}>
                {summary.single_sensor.fn} → {summary.compound.fn}
              </span>
              <span className={styles.heroLabel}>
                Stop-work cases missed — single-sensor vs compound (of{" "}
                {summary.positive_count ??
                  summary.single_sensor.tp + summary.single_sensor.fn}
                )
              </span>
              <span className={styles.heroHint}>
                Fewer missed stop-work cases, scored on the same labeled set
              </span>
            </div>
            <div className={styles.heroStat} data-tone="accent">
              <span className={styles.heroValue}>
                {fmtLead(summary.hero_lead_time_minutes)}
              </span>
              <span className={styles.heroLabel}>
                Lead time before single-sensor critical
              </span>
              <span className={styles.heroHint}>
                Warning on the hero case before the critical threshold alone
                would fire
              </span>
            </div>
            {/* Deliberately shows the cost, not another win. While compound FN is
                zero, "cases only compound catches" is identical to single-sensor's
                miss count — the same number twice. Precision is the counterweight
                that answers "so you just alarm on everything?". */}
            <div className={styles.heroStat}>
              <span className={styles.heroValue}>
                {pct(summary.compound.precision)}
              </span>
              <span className={styles.heroLabel}>
                Compound precision — {summary.compound.fp} false positives, all
                stricter than the statutory minimum
              </span>
              <span className={styles.heroHint}>
                The cost of catching every stop-work case — not another win
                metric
              </span>
            </div>
          </div>

          <section className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>
                Three detectors on the VSP timeline
              </h2>
              <p className={styles.panelSubtitle}>
                Same rising gas story — when each detector would alarm.
              </p>
            </header>
            <div className={styles.panelBody}>
              <div className={styles.lanes} role="list">
                <div className={styles.lane} role="listitem" data-tone="silent">
                  <div className={styles.laneMeta}>
                    <span className={styles.laneName}>Single-sensor</span>
                    <span className={styles.laneVerdict}>Silent until critical</span>
                  </div>
                  <div className={styles.laneTrack}>
                    <div
                      className={styles.laneFill}
                      style={{ width: laneWidth(tCritical) }}
                    />
                    <span
                      className={styles.laneMark}
                      style={{ left: laneWidth(tCritical) }}
                    >
                      {fmtLead(tCritical)}
                    </span>
                  </div>
                  <p className={styles.laneDetail}>
                    FN rate {pct(summary.single_sensor.false_negative_rate)} ·
                    only fires when gas ≥ critical
                  </p>
                </div>

                <div className={styles.lane} role="listitem" data-tone="forecast">
                  <div className={styles.laneMeta}>
                    <span className={styles.laneName}>Predictive forecast</span>
                    <span className={styles.laneVerdict}>Early trend alarm</span>
                  </div>
                  <div className={styles.laneTrack}>
                    <div
                      className={styles.laneFill}
                      style={{ width: laneWidth(tForecast) }}
                    />
                    <span
                      className={styles.laneMark}
                      style={{ left: laneWidth(tForecast) }}
                    >
                      {fmtLead(tForecast)}
                    </span>
                  </div>
                  <p className={styles.laneDetail}>
                    FN rate {pct(summary.forecast.false_negative_rate)} · ML trend
                    toward critical
                  </p>
                </div>

                <div className={styles.lane} role="listitem" data-tone="compound">
                  <div className={styles.laneMeta}>
                    <span className={styles.laneName}>Compound engine</span>
                    <span className={styles.laneVerdict}>Definitive block</span>
                  </div>
                  <div className={styles.laneTrack}>
                    <div
                      className={styles.laneFill}
                      style={{ width: laneWidth(tCompound) }}
                    />
                    <span
                      className={styles.laneMark}
                      style={{ left: laneWidth(tCompound) }}
                    >
                      {fmtLead(tCompound)}
                    </span>
                  </div>
                  <p className={styles.laneDetail}>
                    FN rate {pct(summary.compound.false_negative_rate)} · hazard
                    pathway: atmosphere + ignition + failed control
                  </p>
                </div>
              </div>
              <p className={styles.caption}>
                Hero case <code>{summary.hero_case_id}</code> · compound leads
                single-sensor by {fmtLead(summary.hero_lead_time_minutes)} ·{" "}
                {summary.case_count} labeled cases (
                {summary.positive_count ?? 0} requiring stop-work)
              </p>
            </div>
          </section>

          <section className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>How these cases are labeled</h2>
              {summary.label_basis && (
                <p className={styles.panelSubtitle}>{summary.label_basis}</p>
              )}
            </header>
            <div className={styles.panelBody}>
              <p className={styles.prose}>
                This measures <strong>criterion coverage</strong> — of the
                plant states where a regulation requires stopping, how many
                does each detector catch — not generalization to unseen
                incidents. The comparable baseline is single-sensor scored on
                the same labels: {pct(summary.single_sensor.false_negative_rate)}{" "}
                FN, missing {summary.single_sensor.fn} of{" "}
                {summary.positive_count ?? 0} stop-work cases.
              </p>
              <p className={styles.note}>
                Ground truth is computed from raw sensor and permit payloads in{" "}
                <code>app/eval/hazard_ground_truth.py</code>, which cannot
                import the risk policy it scores — a build test fails if it
                does, and also fails if labels and detector ever agree on{" "}
                <em>every</em> case.
              </p>
            </div>
          </section>

          {summary.regulation_coverage_pct != null && (
            <section className={styles.panel}>
              <header className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Regulatory coverage</h2>
                <p className={styles.panelSubtitle}>
                  Of the fact-bearing cases, how often deterministic retrieval
                  surfaces a matching regulation.
                </p>
              </header>
              <div className={styles.panelBody}>
                <div className={styles.heroStats}>
                  <div className={styles.heroStat} data-tone="accent">
                    <span className={styles.heroValue}>
                      {summary.regulation_coverage_pct.toFixed(1)}%
                    </span>
                    <span className={styles.heroLabel}>
                      Fact-bearing cases with a citable regulation
                    </span>
                  </div>
                  <div className={styles.heroStat}>
                    <span className={styles.heroValue}>
                      {(summary.statutory_coverage_pct ?? 0).toFixed(1)}%
                    </span>
                    <span className={styles.heroLabel}>
                      Citing an Indian statutory provision
                    </span>
                  </div>
                </div>
                {summary.coverage_by_standard && (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Standard</th>
                        <th>Citations available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(summary.coverage_by_standard).map(
                        ([standard, count]) => (
                          <tr key={standard}>
                            <td>{standard}</td>
                            <td>{count}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                )}
                <p className={styles.caption}>
                  Clause-level citations with primary-source links. Retrieval is
                  deterministic SQL by choice, so a citation is always present.
                </p>
              </div>
            </section>
          )}

          <section className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Detector comparison</h2>
              <p className={styles.panelSubtitle}>
                Accuracy, recall, and false-negative rate for each detector,
                scored against the same labels.
              </p>
            </header>
            <div className={styles.panelBody}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Detector</th>
                    <th>Accuracy</th>
                    <th>Recall</th>
                    <th>FN rate</th>
                    <th>Missed</th>
                    <th>Precision</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      summary.single_sensor,
                      summary.forecast,
                      summary.compound,
                    ] as const
                  ).map((d) => (
                    <tr
                      key={d.name}
                      data-highlight={
                        d.name.startsWith("Compound") ? "true" : undefined
                      }
                    >
                      <td>{d.name}</td>
                      <td>{pct(d.accuracy)}</td>
                      <td>{pct(d.recall)}</td>
                      <td>{pct(d.false_negative_rate)}</td>
                      <td>
                        {d.fn} / {d.tp + d.fn}
                      </td>
                      <td>{pct(d.precision)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={styles.caption}>
                All three detectors scored on the same labels.{" "}
                {summary.fn_reduction_pct.toFixed(0)}% false-negative reduction
                is the ratio of the first two FN rates — it is pinned at 100%
                whenever the compound engine misses nothing, so read the raw
                counts rather than the ratio.
              </p>
            </div>
          </section>

          <p className={styles.sourceNote}>
            Source: deterministic detector harness in{" "}
            <code>backend/app/eval/</code> · recomputed fresh on every re-run,
            no database involved
          </p>
        </>
      )}
    </div>
  );
}
