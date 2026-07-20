"use client";

import { useMemo } from "react";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import { useAgentStepsForReview } from "@/lib/liveStore";
import { trendForecastForAssessment } from "@/lib/trendForecast";
import styles from "./TrendForecastCard.module.css";

interface TrendForecastCardProps {
  assessment: AssessmentHistoryItem | null;
  reviewId?: string | null;
}

export function TrendForecastCard({
  assessment,
  reviewId,
}: TrendForecastCardProps) {
  const liveSteps = useAgentStepsForReview(reviewId ?? "");
  const forecast = useMemo(
    () => trendForecastForAssessment(assessment, liveSteps),
    [assessment, liveSteps],
  );

  if (!forecast) return null;

  const hasStats =
    forecast.slopePerMin != null ||
    forecast.etaElevated != null ||
    forecast.etaCritical != null ||
    forecast.rSquared != null;

  return (
    <section className={styles.root} aria-labelledby="trend-forecast-heading">
      <header className={styles.header}>
        <span className={styles.eyebrow}>ML forecast</span>
        <h3 id="trend-forecast-heading" className={styles.title}>
          {forecast.metric} trending up
        </h3>
      </header>

      {hasStats ? (
        <dl className={styles.stats}>
          {forecast.slopePerMin != null ? (
            <div className={styles.stat}>
              <dt className={styles.statLabel}>Slope</dt>
              <dd className={styles.statValue}>
                {forecast.slopePerMin.toFixed(1)}
                <span className={styles.statUnit}>/min</span>
              </dd>
            </div>
          ) : null}
          {forecast.etaElevated ? (
            <div className={styles.stat}>
              <dt className={styles.statLabel}>Elevated</dt>
              <dd className={styles.statValue}>{forecast.etaElevated}</dd>
            </div>
          ) : null}
          {forecast.etaCritical ? (
            <div className={styles.stat} data-emphasis="true">
              <dt className={styles.statLabel}>Critical</dt>
              <dd className={styles.statValue}>{forecast.etaCritical}</dd>
            </div>
          ) : null}
          {forecast.rSquared != null ? (
            <div className={styles.stat}>
              <dt className={styles.statLabel}>Fit R²</dt>
              <dd className={styles.statValue}>
                {forecast.rSquared.toFixed(2)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className={styles.summary}>{forecast.summary}</p>
      )}
    </section>
  );
}
