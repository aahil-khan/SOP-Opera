"use client";

import type { Assessment } from "@/shared/schemas";
import styles from "./AssessmentPanel.module.css";

interface AssessmentPanelProps {
  assessment: Assessment | null;
}

export function AssessmentPanel({ assessment }: AssessmentPanelProps) {
  if (!assessment) {
    return (
      <div className={`panel ${styles.panel}`}>
        <p className={styles.empty}>No assessment yet — start a scenario or wait for AI.</p>
      </div>
    );
  }

  return (
    <div className={`panel ${styles.panel}`}>
      <div className={styles.header}>
        <h3 className={styles.title}>Assessment</h3>
        <span className="badge" data-risk={assessment.risk_level}>
          {assessment.risk_level}
        </span>
        <span className="badge">{assessment.assessment_type}</span>
        <span className="badge">{assessment.status}</span>
      </div>

      <p className={styles.summary}>{assessment.summary}</p>

      {assessment.metadata && (
        <p className={styles.meta}>
          {assessment.metadata.provider}/{assessment.metadata.model} · retrieval{" "}
          {assessment.metadata.retrieval_mode} · quality{" "}
          {assessment.metadata.retrieval_quality}
          {assessment.metadata.retrieval_score != null
            ? ` · score ${assessment.metadata.retrieval_score.toFixed(2)}`
            : ""}{" "}
          · confidence {(assessment.metadata.confidence * 100).toFixed(0)}%
        </p>
      )}

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
    </div>
  );
}
