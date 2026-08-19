"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchEvalSummary, type EvalSummary } from "@/lib/liveApi";
import { RefreshAck, useRefreshAck } from "@/components/common/RefreshAck";
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
  const runAck = useRefreshAck();

  /** Resolves true when the run completed, so the caller can acknowledge it. */
  const refresh = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    try {
      const data = await fetchEvalSummary();
      setSummary(data);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
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
    <div className={styles.page} data-tour="eval-scorecard">
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
        <div className={styles.headerActions}>
          {summary?.generated_at ? (
            <span
              className={styles.runStamp}
              title="The harness executes live on every run — this response was computed on request, not cached"
            >
              ran in {(summary.run_duration_ms / 1000).toFixed(1)}s ·{" "}
              {new Date(summary.generated_at).toLocaleTimeString()}
            </span>
          ) : null}
          <button
            type="button"
            className={styles.refresh}
            disabled={loading}
            // Acknowledge only user-initiated runs; refresh() also fires on
            // mount, where a chip would be noise rather than feedback.
            onClick={() => {
              void refresh().then((ok) => {
                if (ok) runAck.ack();
              });
            }}
          >
            {loading ? "Running…" : "Run now"}
          </button>
          <RefreshAck shown={runAck.acked} label="Re-ran" />
        </div>
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
                  <th>Recall</th>
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
                      { name: "Single-sensor", fn: 0, tp: 0, recall: 0, false_negative_rate: 0, precision: 0, accuracy: 0 },
                      { name: "Forecast", fn: 0, tp: 0, recall: 0, false_negative_rate: 0, precision: 0, accuracy: 0 },
                      { name: "Compound", fn: 0, tp: 0, recall: 0, false_negative_rate: 0, precision: 0, accuracy: 0 },
                    ] as const)
                ).map((d) => (
                  <tr
                    key={d.name}
                    data-highlight={
                      d.name.startsWith("Compound") ? "true" : undefined
                    }
                  >
                    <td>{d.name.replace(/ .*/, "")}</td>
                    <td>{summary ? pct(d.recall) : "—"}</td>
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
            {summary ? (
              <p className={styles.caption}>
                The trade in words: the baseline is{" "}
                {pct(summary.single_sensor.precision)} precise but misses{" "}
                {summary.single_sensor.fn} stop-work cases; compound erases
                every miss for {summary.compound.fp} false alarms (
                {pct(summary.compound.precision)} precision).
              </p>
            ) : null}
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

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Lead time across scenarios</h2>
            <p className={styles.panelSubtitle}>
              Compound alarm vs single-sensor critical, all five scripted
              timelines
            </p>
          </header>
          <div className={styles.panelBody}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Compound</th>
                  <th>Critical</th>
                  <th>Lead</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.lead_times ?? []).map((s) => (
                  <tr
                    key={s.scenario}
                    data-highlight={
                      s.scenario === "vsp_coke_oven" ? "true" : undefined
                    }
                  >
                    <td>{s.scenario}</td>
                    <td>
                      {s.t_compound_minutes != null
                        ? `t+${Math.round(s.t_compound_minutes)}m`
                        : "—"}
                    </td>
                    <td>
                      {s.t_single_sensor_minutes != null
                        ? `t+${Math.round(s.t_single_sensor_minutes)}m`
                        : "—"}
                    </td>
                    <td>{fmtLead(s.lead_time_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.statGrid}>
              <StatPair
                label="Min"
                value={fmtLead(summary?.lead_time_min_minutes)}
                hint="Smallest defined lead time across scenarios"
              />
              <StatPair
                label="Median"
                value={fmtLead(summary?.lead_time_median_minutes)}
                hint="Median over scenarios with a defined lead time"
              />
              <StatPair
                label="Max"
                value={fmtLead(summary?.lead_time_max_minutes)}
                hint="Largest defined lead time across scenarios"
              />
            </div>
            <p className={styles.caption}>
              Lead time is defined for {summary?.lead_time_defined_count ?? 0}{" "}
              of {summary?.lead_times.length ?? 0} scenarios — the rest never
              cross the single-sensor critical line, so there is nothing for
              the baseline to catch late. Scenarios without an explicit
              timeline count one process-minute per step.
            </p>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Hazard-dimension ablation</h2>
            <p className={styles.panelSubtitle}>
              Compound recall with each dimension&apos;s facts suppressed —
              policy treated as a black box
            </p>
          </header>
          <div className={styles.panelBody}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Dimension removed</th>
                  <th>Recall</th>
                  <th>Drop</th>
                  <th>Missed</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.ablation ?? []).map((row) => (
                  <tr key={row.dimension}>
                    <td title={`Facts suppressed: ${row.facts_removed.join(", ")}`}>
                      {row.label}
                    </td>
                    <td>{pct(row.recall)}</td>
                    <td>−{pct(row.recall_drop)}</td>
                    <td>{row.fn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.caption}>
              The drop is that dimension&apos;s contribution to catching
              stop-work cases; only the fact set fed to{" "}
              <code>classify()</code> changes, never its rules or the labels.
            </p>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>What this measures</h2>
            <p className={styles.panelSubtitle}>
              The caveat from the eval report, on the page it qualifies
            </p>
          </header>
          <div className={styles.panelBody}>
            <p className={styles.caveat}>
              {summary?.criterion_caveat ||
                "Criterion-coverage measurement — see docs/eval-report.md."}
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
