"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAiOpsSummary, type AiOpsSummary } from "@/lib/liveApi";
import styles from "./AIOpsDashboard.module.css";

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
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

  const cards = summary
    ? [
        { label: "Success rate", value: pct(summary.success_rate) },
        { label: "Failed assessments", value: String(summary.failed_count) },
        {
          label: "Validation failures",
          value: String(summary.validation_failure_count),
        },
        { label: "RAG hit rate", value: pct(summary.rag_hit_rate) },
        { label: "RAG fallback rate", value: pct(summary.rag_fallback_rate) },
        {
          label: "Mean retrieval relevance",
          value:
            summary.mean_retrieval_relevance == null
              ? "—"
              : summary.mean_retrieval_relevance.toFixed(3),
        },
      ]
    : [];

  return (
    <div className={styles.dash}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>
            AI Ops <span className={styles.aiMark}>AI</span>
          </h1>
          <p className={styles.meta}>
            Pipeline health over AI assessments
            {summary ? ` · ${summary.total_assessments} total` : ""}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.grid}>
        {cards.map((c) => (
          <div key={c.label} className={styles.card}>
            <p className={styles.cardLabel}>{c.label}</p>
            <p className={styles.cardValue}>{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
