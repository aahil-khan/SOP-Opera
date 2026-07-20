import type { AssessmentHistoryItem } from "@/lib/liveApi";
import type { RiskLevel } from "@/shared/enums";
import styles from "./AssessingBanner.module.css";

export type AssessingTone = "initial" | "reassess" | "escalate";

export interface AssessingBannerProps {
  /** Prior settled assessment risk, when this is a re-run. */
  priorRisk?: RiskLevel | null;
  /** Live provisional risk while regenerating (may include "critical"). */
  provisionalRisk?: string | null;
  sensorCritical?: boolean;
}

const RISK_RANK: Record<string, number> = {
  nominal: 0,
  elevated: 1,
  blocking: 2,
  critical: 3,
  halted: 3,
};

function rank(risk: string | null | undefined): number {
  if (!risk) return -1;
  return RISK_RANK[risk] ?? -1;
}

function formatRisk(risk: string): string {
  return risk.replaceAll("_", " ");
}

/** Most recent settled assessment still visible while a new one is in flight. */
export function priorSettledAssessment(
  items: AssessmentHistoryItem[] | undefined | null,
): AssessmentHistoryItem | null {
  if (!items?.length) return null;
  return (
    items.find((a) => a.status === "complete") ??
    items.find((a) => a.status === "superseded") ??
    items.find((a) => a.status === "failed") ??
    null
  );
}

export function assessingTone(
  priorRisk: RiskLevel | null | undefined,
  provisionalRisk: string | null | undefined,
  sensorCritical = false,
): AssessingTone {
  if (!priorRisk) return "initial";
  const next = sensorCritical ? "critical" : provisionalRisk;
  if (rank(next) > rank(priorRisk)) return "escalate";
  return "reassess";
}

export function AssessingBanner({
  priorRisk = null,
  provisionalRisk = null,
  sensorCritical = false,
}: AssessingBannerProps) {
  const tone = assessingTone(priorRisk, provisionalRisk, sensorCritical);
  const displayNext = sensorCritical
    ? "critical"
    : provisionalRisk && provisionalRisk !== "nominal"
      ? provisionalRisk
      : null;

  let title = "Generating assessment";
  let hint =
    "Domain agents are analyzing signals and drafting a recommendation. This usually takes a few moments.";

  if (tone === "escalate") {
    title = "Risk escalated — reassessment in progress";
    const from = priorRisk ? formatRisk(priorRisk) : "prior level";
    const to = displayNext ? formatRisk(displayNext) : "a higher level";
    hint = sensorCritical
      ? `Live sensors crossed a critical threshold while you were reviewing (was ${from}). Hold any decision until the new recommendation is ready.`
      : `Situation worsened while you were reviewing: ${from} → ${to}. Hold any decision until the new recommendation is ready.`;
  } else if (tone === "reassess") {
    title = "Situation updated — reassessment in progress";
    hint = priorRisk
      ? `New signals arrived while you were reviewing the ${formatRisk(priorRisk)} case. Prior recommendation may change — wait for the updated assessment.`
      : "New signals arrived while you were reviewing. Prior recommendation may change — wait for the updated assessment.";
  }

  return (
    <div
      className={styles.banner}
      data-tone={tone}
      aria-live="assertive"
      aria-busy="true"
      role="status"
    >
      <span className={styles.spinner} aria-hidden />
      <div className={styles.copy}>
        <p className={styles.title}>{title}</p>
        <p className={styles.hint}>{hint}</p>
        {tone !== "initial" && (priorRisk || displayNext) ? (
          <p className={styles.riskRow}>
            {priorRisk ? (
              <span className={styles.riskChip} data-risk={priorRisk}>
                was {formatRisk(priorRisk)}
              </span>
            ) : null}
            {priorRisk && displayNext ? (
              <span className={styles.riskArrow} aria-hidden>
                →
              </span>
            ) : null}
            {displayNext ? (
              <span className={styles.riskChip} data-risk={displayNext}>
                now {formatRisk(displayNext)}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
