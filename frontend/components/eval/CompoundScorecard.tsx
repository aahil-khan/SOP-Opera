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

function HeroStat({
  value,
  label,
  hint,
  tone = "neutral",
}: {
  value: string;
  label: string;
  hint: string;
  tone?: "good" | "accent" | "neutral";
}) {
  return (
    <div className={styles.hero} data-tone={tone} title={hint}>
      <span className={styles.heroValue}>{value}</span>
      <span className={styles.heroLabel}>{label}</span>
      <span className={styles.heroHint}>{hint}</span>
    </div>
  );
}

function StatPair({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className={styles.statPair} title={hint}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

/** Full page scorecard for /eval — same glanceable shell as /ai-ops. */
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
  const span = tCritical != null && tCritical > 0 ? tCritical : 34;
  const positives =
    summary?.positive_count ??
    (summary
      ? summary.single_sensor.tp + summary.single_sensor.fn
      : null);

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
            Stop-work cases labeled from statute
            {summary
              ? ` · ${summary.case_count} cases · ${positives} requiring stop-work`
              : ""}
          </p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "…" : "Re-run"}
        </button>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.heroRow} aria-label="Key metrics">
        <HeroStat
          value={
            summary
              ? `${summary.single_sensor.fn} → ${summary.compound.fn}`
              : "—"
          }
          label="Missed stop-work"
          hint={
            positives != null
              ? `Single-sensor vs compound false negatives of ${positives} labeled stop-work cases`
              : "Single-sensor vs compound false negatives on labeled stop-work cases"
          }
          tone={summary ? "good" : "neutral"}
        />
        <HeroStat
          value={fmtLead(summary?.hero_lead_time_minutes)}
          label="Lead time"
          hint="Plant-process minutes compound warns before the single-sensor critical line on the VSP hero case"
          tone={summary ? "accent" : "neutral"}
        />
        <HeroStat
          value={summary ? pct(summary.compound.precision) : "—"}
          label="Compound precision"
          hint={`${summary?.compound.fp ?? 0} false positives — stricter than the statutory minimum, not a free lunch`}
        />
        <HeroStat
          value={
            summary?.statutory_coverage_pct != null
              ? `${summary.statutory_coverage_pct.toFixed(0)}%`
              : "—"
          }
          label="Statutory coverage"
          hint="Share of fact-bearing cases with an Indian statutory citation (Factories Act / OISD)"
          tone={summary ? "accent" : "neutral"}
        />
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>VSP timeline</h2>
            <p className={styles.panelSubtitle}>
              When each detector alarms on the rising-gas story
            </p>
          </header>
          <div className={styles.panelBody}>
            <div className={styles.lanes} role="list">
              <div className={styles.lane} role="listitem" data-tone="silent">
                <div className={styles.laneMeta}>
                  <span className={styles.laneName}>Single-sensor</span>
                  <span className={styles.laneValue}>{fmtLead(tCritical)}</span>
                </div>
                <div className={styles.laneTrack}>
                  <div
                    className={styles.laneFill}
                    style={{ width: laneWidth(tCritical) }}
                  />
                </div>
                <p className={styles.laneDetail}>
                  FN{" "}
                  {summary
                    ? pct(summary.single_sensor.false_negative_rate)
                    : "—"}{" "}
                  · fires at critical only
                </p>
              </div>

              <div className={styles.lane} role="listitem" data-tone="forecast">
                <div className={styles.laneMeta}>
                  <span className={styles.laneName}>Forecast</span>
                  <span className={styles.laneValue}>{fmtLead(tForecast)}</span>
                </div>
                <div className={styles.laneTrack}>
                  <div
                    className={styles.laneFill}
                    style={{ width: laneWidth(tForecast) }}
                  />
                </div>
                <p className={styles.laneDetail}>
                  FN{" "}
                  {summary ? pct(summary.forecast.false_negative_rate) : "—"} ·
                  ML trend toward critical
                </p>
              </div>

              <div className={styles.lane} role="listitem" data-tone="compound">
                <div className={styles.laneMeta}>
                  <span className={styles.laneName}>Compound</span>
                  <span className={styles.laneValue}>{fmtLead(tCompound)}</span>
                </div>
                <div className={styles.laneTrack}>
                  <div
                    className={styles.laneFill}
                    style={{ width: laneWidth(tCompound) }}
                  />
                </div>
                <p className={styles.laneDetail}>
                  FN{" "}
                  {summary ? pct(summary.compound.false_negative_rate) : "—"} ·
                  atmosphere + ignition + failed control
                </p>
              </div>
            </div>
            <p className={styles.caption}>
              Hero <code>{summary?.hero_case_id ?? "—"}</code> · compound leads
              by {fmtLead(summary?.hero_lead_time_minutes)}
            </p>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Detector comparison</h2>
            <p className={styles.panelSubtitle}>
              Same statutory labels for every detector
            </p>
          </header>
          <div className={styles.panelBody}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Detector</th>
                  <th>FN</th>
                  <th>Missed</th>
                  <th>Prec.</th>
                  <th>Acc.</th>
                </tr>
              </thead>
              <tbody>
                {(summary
                  ? ([
                      summary.single_sensor,
                      summary.forecast,
                      summary.compound,
                    ] as const)
                  : ([
                      { name: "Single-sensor", fn: 0, tp: 0, false_negative_rate: 0, precision: 0, accuracy: 0 },
                      { name: "Forecast", fn: 0, tp: 0, false_negative_rate: 0, precision: 0, accuracy: 0 },
                      { name: "Compound", fn: 0, tp: 0, false_negative_rate: 0, precision: 0, accuracy: 0 },
                    ] as const)
                ).map((d) => (
                  <tr
                    key={d.name}
                    data-highlight={
                      d.name.startsWith("Compound") ? "true" : undefined
                    }
                  >
                    <td>{d.name.replace(/ .*/, "")}</td>
                    <td>{summary ? pct(d.false_negative_rate) : "—"}</td>
                    <td>
                      {summary ? `${d.fn}/${d.tp + d.fn}` : "—"}
                    </td>
                    <td>{summary ? pct(d.precision) : "—"}</td>
                    <td>{summary ? pct(d.accuracy) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.statGrid}>
              <StatPair
                label="FN reduction"
                value={
                  summary ? `${summary.fn_reduction_pct.toFixed(0)}%` : "—"
                }
                hint="Pinned at 100% whenever compound FN is zero — prefer the missed counts above"
              />
              <StatPair
                label="Compound FP"
                value={summary ? String(summary.compound.fp) : "—"}
                hint="Cases where we stop work and the statute does not strictly require it"
              />
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Coverage & labels</h2>
            <p className={styles.panelSubtitle}>
              {summary?.label_basis ??
                "Statutory stop-work criteria, independent of the risk policy"}
            </p>
          </header>
          <div className={styles.panelBody}>
            <div className={styles.statGrid}>
              <StatPair
                label="Citable regs"
                value={
                  summary?.regulation_coverage_pct != null
                    ? `${summary.regulation_coverage_pct.toFixed(0)}%`
                    : "—"
                }
                hint="Fact-bearing cases with a regulation the deterministic retriever can cite"
              />
              <StatPair
                label="Statutory"
                value={
                  summary?.statutory_coverage_pct != null
                    ? `${summary.statutory_coverage_pct.toFixed(0)}%`
                    : "—"
                }
                hint="Citing an Indian statutory provision (Factories Act / OISD)"
              />
              <StatPair
                label="Stop-work"
                value={
                  summary && positives != null
                    ? `${positives}/${summary.case_count}`
                    : "—"
                }
                hint="Cases where a statutory provision requires stopping work"
              />
              <StatPair
                label="Baseline miss"
                value={
                  summary && positives != null
                    ? `${summary.single_sensor.fn}/${positives}`
                    : "—"
                }
                hint="Single-sensor false negatives on the same labels"
              />
            </div>
            {summary?.coverage_by_standard ? (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Standard</th>
                    <th>Citations</th>
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
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Standard</th>
                    <th>Citations</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className={styles.caption}>
              Labels from <code>hazard_ground_truth.py</code> — cannot import
              the risk policy it scores.
            </p>
          </div>
        </section>
      </div>

      <p className={styles.sourceNote}>
        Source: deterministic harness in <code>backend/app/eval/</code> · fresh
        on every re-run · no database
      </p>
    </div>
  );
}
