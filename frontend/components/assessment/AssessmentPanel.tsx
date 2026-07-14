"use client";

import { useState } from "react";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import type { RiskLevel } from "@/shared/enums";
import styles from "./AssessmentPanel.module.css";

interface AssessmentPanelProps {
  reviewId: string;
  reviewState: string;
  assessment: AssessmentHistoryItem | null;
}

export function AssessmentPanel({
  reviewId,
  reviewState,
  assessment,
}: AssessmentPanelProps) {
  const retryAssessment = useLiveStore((s) => s.retryAssessment);
  const submitManualAssessment = useLiveStore((s) => s.submitManualAssessment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [summary, setSummary] = useState("");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("blocking");
  const [recText, setRecText] = useState("");
  const [recRationale, setRecRationale] = useState("");

  if (!assessment) {
    return (
      <div className={`panel ${styles.panel}`}>
        <p className={styles.empty}>
          No assessment yet — waiting for the pipeline or a Manual Assessment.
        </p>
      </div>
    );
  }

  const failed = assessment.status === "failed";
  const canRecover = failed && reviewState === "assessing";

  async function onRetry() {
    setBusy(true);
    setError(null);
    try {
      await retryAssessment(reviewId, "mock");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onManual() {
    if (!summary.trim() || !recText.trim()) {
      setError("Summary and at least one recommendation are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitManualAssessment(reviewId, {
        summary: summary.trim(),
        risk_level: riskLevel,
        recommendations: [
          {
            text: recText.trim(),
            rationale: recRationale.trim() || "Supervisor judgment",
          },
        ],
      });
      setShowManual(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`panel ${styles.panel}`}>
      <div className={styles.header}>
        <h3 className={styles.title}>Assessment</h3>
        {assessment.risk_level && (
          <span className="badge" data-risk={assessment.risk_level}>
            {assessment.risk_level}
          </span>
        )}
        <span className="badge">{assessment.assessment_type}</span>
        <span className="badge">{assessment.status}</span>
      </div>

      <p className={styles.summary}>
        {assessment.summary ||
          (assessment.status === "pending" || assessment.status === "generating"
            ? "Generating…"
            : "—")}
      </p>

      {assessment.metadata && (
        <p className={styles.meta}>
          {assessment.metadata.provider}/{assessment.metadata.model} · retrieval{" "}
          {assessment.metadata.retrieval_mode} · quality{" "}
          {assessment.metadata.retrieval_quality}
          {assessment.metadata.retrieval_score != null
            ? ` · score ${assessment.metadata.retrieval_score.toFixed(2)}`
            : ""}{" "}
          · confidence{" "}
          {((assessment.metadata.confidence ?? 0) * 100).toFixed(0)}%
        </p>
      )}

      {assessment.recommendations.length > 0 && (
        <div>
          <h4 className={styles.recTitle}>Recommendations</h4>
          <ul className={styles.recList}>
            {assessment.recommendations.map((rec) => (
              <li key={rec.id} className={styles.recItem}>
                <p className={styles.recText}>{rec.text}</p>
                <p className={styles.recRationale}>{rec.rationale}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canRecover && (
        <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
          <p className={styles.empty} style={{ margin: 0 }}>
            Assessment failed. Retry AI or author a Manual Assessment to continue.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void onRetry()}
            >
              Retry AI
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setShowManual((v) => !v)}
            >
              {showManual ? "Hide manual form" : "Create Manual Assessment"}
            </button>
          </div>

          {showManual && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <label>
                Risk level
                <select
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
                  style={{ display: "block", width: "100%", marginTop: 4 }}
                >
                  <option value="nominal">nominal</option>
                  <option value="elevated">elevated</option>
                  <option value="blocking">blocking</option>
                </select>
              </label>
              <textarea
                placeholder="Summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                style={{ width: "100%" }}
              />
              <input
                placeholder="Recommendation"
                value={recText}
                onChange={(e) => setRecText(e.target.value)}
                style={{ width: "100%" }}
              />
              <input
                placeholder="Rationale"
                value={recRationale}
                onChange={(e) => setRecRationale(e.target.value)}
                style={{ width: "100%" }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void onManual()}
              >
                Submit Manual Assessment
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ color: "#f07178", marginTop: "0.75rem", fontSize: "0.85rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
