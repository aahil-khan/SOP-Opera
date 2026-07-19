"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAiOpsSummary, type AiOpsSummary } from "@/lib/liveApi";
import styles from "./AIOpsDashboard.module.css";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
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

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.item}>
      <span className={styles.itemName}>{label}</span>
      <span className={styles.itemMeta}>{value}</span>
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

  return (
    <div className={styles.wrap}>
      <div className={styles.topPanel}>
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

        <div className={styles.kpis} aria-label="Key metrics">
          <div className={styles.kpi}>
            <span className={styles.kpiValue}>
              {summary ? pct(summary.success_rate) : "—"}
            </span>
            <span className={styles.kpiLabel}>Success</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiValue}>
              {fmtLatency(summary?.mean_latency_ms)}
            </span>
            <span className={styles.kpiLabel}>Mean latency</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiValue}>
              {summary ? fmtTokens(totalTokens) : "—"}
            </span>
            <span className={styles.kpiLabel}>Total tokens</span>
          </div>
          <div
            className={styles.kpi}
            data-warn={
              summary != null && summary.total_cost_usd > 0 ? "true" : undefined
            }
          >
            <span className={styles.kpiValue}>
              {summary ? fmtCost(summary.total_cost_usd) : "—"}
            </span>
            <span className={styles.kpiLabel}>Total cost</span>
          </div>
        </div>
      </div>

      <div className={styles.columns}>
        <section className={styles.sidePanel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Pipeline health</h2>
          </header>
          <div className={styles.panelBody}>
            <StatRow
              label="Failed assessments"
              value={summary ? String(summary.failed_count) : "—"}
            />
            <StatRow
              label="Validation failures"
              value={summary ? String(summary.validation_failure_count) : "—"}
            />
            <StatRow
              label="Provider errors"
              value={summary ? String(summary.provider_error_count) : "—"}
            />
            <StatRow
              label="RAG hit rate"
              value={summary ? pct(summary.rag_hit_rate) : "—"}
            />
            <StatRow
              label="RAG fallback rate"
              value={summary ? pct(summary.rag_fallback_rate) : "—"}
            />
            <StatRow
              label="Mean retrieval relevance"
              value={
                summary?.mean_retrieval_relevance == null
                  ? "—"
                  : summary.mean_retrieval_relevance.toFixed(3)
              }
            />
          </div>
        </section>

        <section className={styles.sidePanel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Agent path</h2>
          </header>
          <div className={styles.panelBody}>
            <StatRow
              label="Input tokens"
              value={summary ? fmtTokens(summary.total_input_tokens) : "—"}
            />
            <StatRow
              label="Output tokens"
              value={summary ? fmtTokens(summary.total_output_tokens) : "—"}
            />
            <StatRow
              label="Mean cost / run"
              value={
                summary?.mean_cost_usd == null
                  ? "—"
                  : fmtCost(summary.mean_cost_usd)
              }
            />
            <StatRow
              label="Complete runs"
              value={summary ? String(summary.complete_count) : "—"}
            />
            <p className={styles.note}>
              Tokens and cost come from LangGraph LLM calls (domain narration +
              orchestrator). Ollama and mock record $0. Traces live in LangSmith
              {summary?.langsmith_project
                ? ` (“${summary.langsmith_project}”)`
                : ""}
              .
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
