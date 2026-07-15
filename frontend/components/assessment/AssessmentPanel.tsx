"use client";

import { useState } from "react";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import type { ReasoningFactor, RetrievedReference } from "@/shared/schemas";
import type { RiskLevel } from "@/shared/enums";
import styles from "./AssessmentPanel.module.css";

interface AssessmentPanelProps {
  reviewId: string;
  reviewState: string;
  assessment: AssessmentHistoryItem | null;
}

function refLabel(r: RetrievedReference): string {
  if (r.code && r.title) return `${r.code}: ${r.title}`;
  if (r.title) return r.title;
  return r.source.replaceAll("_", " ");
}

function FactorCards({ factors }: { factors: ReasoningFactor[] }) {
  if (factors.length === 0) return null;
  return (
    <ul className={styles.factorList}>
      {factors.map((f) => (
        <li key={f.fact_type} className={styles.factorItem}>
          <p className={styles.factorHeadline}>{f.headline}</p>
          <p className={styles.factorDetail}>{f.detail}</p>
          {f.evidence.length > 0 && (
            <ul className={styles.factorEvidence}>
              {f.evidence.map((e) => (
                <li key={`${e.source}-${e.id}`}>{refLabel(e)}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
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
  const factors =
    assessment.reasoning_factors ??
    assessment.metadata?.reasoning_factors ??
    [];

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

      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Why</h4>
        <p className={styles.summary}>
          {assessment.summary ||
            (assessment.status === "pending" ||
            assessment.status === "generating"
              ? "Generating…"
              : "—")}
        </p>
        <FactorCards factors={factors} />
        {assessment.metadata && (
          <p className={styles.meta}>
            {assessment.metadata.provider}/{assessment.metadata.model} ·
            retrieval {assessment.metadata.retrieval_mode} · quality{" "}
            {assessment.metadata.retrieval_quality}
            {assessment.metadata.retrieval_score != null
              ? ` · score ${assessment.metadata.retrieval_score.toFixed(2)}`
              : ""}{" "}
            · confidence{" "}
            {((assessment.metadata.confidence ?? 0) * 100).toFixed(0)}%
          </p>
        )}
      </section>

      {assessment.retrieved_references.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Cited resources</h4>
          <ul className={styles.refList}>
            {assessment.retrieved_references.map((r) => (
              <li key={`${r.source}-${r.id}`} className={styles.refItem}>
                <span className={styles.refSource}>
                  {r.source.replaceAll("_", " ")}
                </span>
                <p className={styles.refTitle}>{refLabel(r)}</p>
                {r.snippet && (
                  <p className={styles.refSnippet}>{r.snippet}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {assessment.recommendations.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Recommended action</h4>
          <ul className={styles.recList}>
            {assessment.recommendations.map((rec) => (
              <li key={rec.id} className={styles.recItem}>
                <p className={styles.recText}>{rec.text}</p>
                <p className={styles.recRationale}>{rec.rationale}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canRecover && (
        <div className={styles.recover}>
          <p className={styles.empty}>
            Assessment failed. Retry AI or author a Manual Assessment to
            continue.
          </p>
          <div className={styles.actions}>
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
            <div className={styles.manualForm}>
              <label className={styles.field}>
                Risk level
                <select
                  className={styles.fieldControl}
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value as RiskLevel)}
                >
                  <option value="nominal">nominal</option>
                  <option value="elevated">elevated</option>
                  <option value="blocking">blocking</option>
                </select>
              </label>
              <textarea
                className={styles.fieldControl}
                placeholder="Summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
              />
              <input
                className={styles.fieldControl}
                placeholder="Recommendation"
                value={recText}
                onChange={(e) => setRecText(e.target.value)}
              />
              <input
                className={styles.fieldControl}
                placeholder="Rationale"
                value={recRationale}
                onChange={(e) => setRecRationale(e.target.value)}
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

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
