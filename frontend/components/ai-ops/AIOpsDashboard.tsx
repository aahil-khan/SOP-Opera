"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAiOpsSummary, type AiOpsSummary } from "@/lib/liveApi";
import styles from "./AIOpsDashboard.module.css";

type Tone = "good" | "warn" | "bad" | "neutral";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function rateTone(rate: number, goodMin: number, warnMin: number): Tone {
  if (rate >= goodMin) return "good";
  if (rate >= warnMin) return "warn";
  return "bad";
}

function inverseRateTone(rate: number, warnMax: number, badMax: number): Tone {
  if (rate <= warnMax) return "good";
  if (rate <= badMax) return "warn";
  return "bad";
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
  tone?: Tone;
}) {
  return (
    <div className={styles.hero} data-tone={tone} title={hint}>
      <span className={styles.heroValue}>{value}</span>
      <span className={styles.heroLabel}>{label}</span>
      <span className={styles.heroHint}>{hint}</span>
    </div>
  );
}

function RateBar({
  label,
  value,
  displayValue,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  displayValue: string;
  hint: string;
  tone?: Tone;
}) {
  return (
    <div className={styles.rate} data-tone={tone} title={hint}>
      <div className={styles.rateHead}>
        <span className={styles.rateLabel}>{label}</span>
        <span className={styles.rateValue}>{displayValue}</span>
      </div>
      <div className={styles.rateTrack}>
        <div
          className={styles.rateFill}
          style={{ width: `${clamp01(value) * 100}%` }}
        />
      </div>
      <p className={styles.rateDetail}>{hint}</p>
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

export function AIOpsDashboard() {
  const [summary, setSummary] = useState<AiOpsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAiOpsSummary();
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

  const totalTokens =
    (summary?.total_input_tokens ?? 0) + (summary?.total_output_tokens ?? 0);
  const tracingOn = Boolean(summary?.langsmith_enabled);
  const inputShare =
    summary && totalTokens > 0 ? summary.total_input_tokens / totalTokens : 0;

  return (
    <div className={styles.wrap} data-tour="aiops">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>AI Ops</h1>
          <p className={styles.subtitle}>
            Agent-path spend and pipeline health
            {summary ? ` · ${summary.total_assessments} assessments` : ""}
          </p>
        </div>
        <div className={styles.headerControls}>
          <span
            className={styles.traceChip}
            data-on={tracingOn}
            title={
              tracingOn
                ? `Project: ${summary?.langsmith_project ?? "sop-opera"}`
                : "Set LANGCHAIN_TRACING_V2 and LANGCHAIN_API_KEY"
            }
          >
            <span className={styles.liveDot} data-on={tracingOn} aria-hidden />
            {tracingOn ? "LangSmith" : "Offline"}
          </span>
          <button
            type="button"
            className={styles.ctrl}
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "…" : "Refresh"}
          </button>
          {tracingOn && summary?.langsmith_url ? (
            <a
              className={styles.primaryCtrl}
              href={summary.langsmith_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open LangSmith
            </a>
          ) : (
            <button type="button" className={styles.primaryCtrl} disabled>
              Open LangSmith
            </button>
          )}
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.heroRow} aria-label="Key metrics">
        <HeroStat
          value={summary ? pct(summary.success_rate) : "—"}
          label="Success rate"
          hint="Share of assessment runs that reached a complete verdict, all-time"
          tone={summary ? rateTone(summary.success_rate, 0.95, 0.85) : "neutral"}
        />
        <HeroStat
          value={fmtLatency(summary?.mean_latency_ms)}
          label="Mean latency"
          hint="Average wall-clock time from job claim to persisted verdict"
        />
        <HeroStat
          value={summary ? fmtTokens(totalTokens) : "—"}
          label="Total tokens"
          hint="Combined input + output tokens across every LangGraph LLM call"
        />
        <HeroStat
          value={summary ? fmtCost(summary.total_cost_usd) : "—"}
          label="Total cost"
          hint="Estimated USD from token pricing tables — mock and Ollama always record $0"
          tone={summary && summary.total_cost_usd > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Reliability</h2>
            <p className={styles.panelSubtitle}>
              How often assessment runs finish cleanly
            </p>
          </header>
          <div className={styles.panelBody}>
            <RateBar
              label="Success rate"
              value={summary?.success_rate ?? 0}
              displayValue={summary ? pct(summary.success_rate) : "—"}
              hint="Share of runs that reached a complete verdict without failing validation or a provider error"
              tone={
                summary ? rateTone(summary.success_rate, 0.95, 0.85) : "neutral"
              }
            />
            <RateBar
              label="LLM fallback rate"
              value={summary?.llm_fallback_rate ?? 0}
              displayValue={summary ? pct(summary.llm_fallback_rate) : "—"}
              hint="Share of live-provider LLM attempts that fell back to a template response instead of a real model output"
              tone={
                summary
                  ? inverseRateTone(summary.llm_fallback_rate, 0.05, 0.25)
                  : "neutral"
              }
            />
            <div className={styles.statGrid}>
              <StatPair
                label="Failed"
                value={summary ? String(summary.failed_count) : "—"}
                hint="Runs that never reached a verdict"
              />
              <StatPair
                label="Validation failures"
                value={
                  summary ? String(summary.validation_failure_count) : "—"
                }
                hint="Failed runs where the LLM output didn't pass schema validation after retries"
              />
              <StatPair
                label="Provider errors"
                value={summary ? String(summary.provider_error_count) : "—"}
                hint="Failed runs where the provider call itself errored — timeout, API error, or similar"
              />
              <StatPair
                label="LLM-degraded"
                value={summary ? String(summary.degraded_count) : "—"}
                hint="Completed runs where at least one agent call fell back to a template while the pipeline still finished"
              />
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Retrieval quality</h2>
            <p className={styles.panelSubtitle}>
              How often RAG finds usable evidence
            </p>
          </header>
          <div className={styles.panelBody}>
            <RateBar
              label="RAG hit rate"
              value={summary?.rag_hit_rate ?? 0}
              displayValue={summary ? pct(summary.rag_hit_rate) : "—"}
              hint="Share of retrievals where vector search over historical incidents cleared the relevance quality gate"
              tone={
                summary ? rateTone(summary.rag_hit_rate, 0.8, 0.5) : "neutral"
              }
            />
            <RateBar
              label="RAG fallback rate"
              value={summary?.rag_fallback_rate ?? 0}
              displayValue={summary ? pct(summary.rag_fallback_rate) : "—"}
              hint="Share of runs where vector search missed the quality gate and deterministic SQL filled in"
              tone={
                summary
                  ? inverseRateTone(summary.rag_fallback_rate, 0.15, 0.4)
                  : "neutral"
              }
            />
            <RateBar
              label="Mean retrieval relevance"
              value={summary?.mean_retrieval_relevance ?? 0}
              displayValue={
                summary?.mean_retrieval_relevance == null
                  ? "—"
                  : summary.mean_retrieval_relevance.toFixed(3)
              }
              hint="Average cosine-similarity score of the historical-incident chunks that cleared the RAG quality gate (RAG hits only, 0–1)"
              tone="neutral"
            />
            <div className={styles.statGrid}>
              <StatPair
                label="Retrievals run"
                value={summary ? String(summary.retrieval_ran_count) : "—"}
                hint="Runs that had at least one derived fact to retrieve context for"
              />
              <StatPair
                label="Complete runs"
                value={summary ? String(summary.complete_count) : "—"}
                hint="Runs that reached a persisted verdict"
              />
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Agent spend</h2>
            <p className={styles.panelSubtitle}>
              Token volume and USD cost across LLM calls
            </p>
          </header>
          <div className={styles.panelBody}>
            <div
              className={styles.tokenSplit}
              title="Combined input + output tokens across every LangGraph LLM call (domain narration + orchestrator), all-time"
            >
              <div className={styles.tokenSplitHead}>
                <span className={styles.rateLabel}>Input / output tokens</span>
                <span className={styles.rateValue}>
                  {summary ? fmtTokens(totalTokens) : "—"}
                </span>
              </div>
              <div className={styles.tokenTrack}>
                <div
                  className={styles.tokenFillInput}
                  style={{ width: `${inputShare * 100}%` }}
                />
                <div
                  className={styles.tokenFillOutput}
                  style={{ width: `${(1 - inputShare) * 100}%` }}
                />
              </div>
              <div className={styles.tokenLegend}>
                <span>
                  <i className={styles.legendDotInput} aria-hidden />
                  Input {summary ? fmtTokens(summary.total_input_tokens) : "—"}
                </span>
                <span>
                  <i className={styles.legendDotOutput} aria-hidden />
                  Output{" "}
                  {summary ? fmtTokens(summary.total_output_tokens) : "—"}
                </span>
              </div>
            </div>
            <div className={styles.statGrid}>
              <StatPair
                label="Mean cost / run"
                value={
                  summary?.mean_cost_usd == null
                    ? "—"
                    : fmtCost(summary.mean_cost_usd)
                }
                hint="Average estimated cost per completed run"
              />
              <StatPair
                label="Total cost"
                value={summary ? fmtCost(summary.total_cost_usd) : "—"}
                hint="Cumulative estimated spend, all-time"
              />
            </div>
            <p className={styles.note}>
              Tokens and cost come from LangGraph LLM calls (domain narration +
              orchestrator). Ollama and mock record $0. KPIs aggregate the
              local <code>ai_ops_events</code> log — demo reset clears
              incident state, not this history. Optional LangSmith traces
              (when configured) are for per-run debugging only
              {summary?.langsmith_project
                ? ` (“${summary.langsmith_project}”)`
                : ""}
              .
            </p>
          </div>
        </section>
      </div>

      <p className={styles.sourceNote}>
        Source: local database
        {summary?.persists_across_demo_reset
          ? " · all-time history (not cleared on demo reset)"
          : ""}
        {tracingOn ? " · optional LangSmith tracing for run-level traces" : ""}
      </p>
    </div>
  );
}
