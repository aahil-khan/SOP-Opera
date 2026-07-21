"use client";

import { useEffect, useMemo, useState } from "react";
import {
  findViewByReviewId,
  useLiveStore,
} from "@/lib/liveStore";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import { AssessmentPanel } from "@/components/assessment/AssessmentPanel";
import {
  AssessingBanner,
  priorSettledAssessment,
} from "@/components/assessment/AssessingBanner";
import { DecisionPanel } from "@/components/decision/DecisionPanel";
import { DecisionCard } from "@/components/decision/DecisionCard";
import { AgentTracePanel } from "@/components/trace/AgentTracePanel";
import { IssueReport } from "@/components/reviews/IssueReport";
import { ReviewThread } from "@/components/thread/ReviewThread";
import { nextActionForView, ownerNameForView } from "@/lib/openWork";
import { openWorkDisplayRisk } from "@/lib/sensorThresholds";
import actionStyles from "@/components/decision/RecommendedAction.module.css";
import styles from "./ReviewDetail.module.css";

interface ReviewDetailProps {
  reviewId: string;
  /** In-drawer twin embedding: single column, no page chrome. */
  variant?: "page" | "embedded";
  /**
   * Supervisor board: summary + thread only — no why/citations, agent
   * trace, recommended action, or assessment panel.
   */
  audience?: "operator" | "supervisor";
}

export function ReviewDetail({
  reviewId,
  variant = "page",
  audience = "operator",
}: ReviewDetailProps) {
  const embedded = variant === "embedded";
  const supervisorAudience = audience === "supervisor";
  const loadReviewDetail = useLiveStore((s) => s.loadReviewDetail);
  const listReview = useLiveStore((s) =>
    s.reviews.find((r) => r.id === reviewId) ?? null,
  );
  const listAsset = useLiveStore((s) => {
    const r = s.reviews.find((x) => x.id === reviewId);
    if (!r) return null;
    return s.assets.find((a) => a.id === r.asset_id) ?? null;
  });
  const detail = useLiveStore((s) => s.reviewDetails[reviewId]);
  const assessments = useLiveStore((s) => s.assessmentsByReview[reviewId]);
  const sensorCriticalByAsset = useLiveStore((s) => s.sensorCriticalByAsset);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [otherActionsOpen, setOtherActionsOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadReviewDetail(reviewId).catch((err: Error) => {
      if (!cancelled) setLoadError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [reviewId, loadReviewDetail]);

  const view = useMemo(() => {
    if (!listReview || !listAsset) return undefined;
    return findViewByReviewId(
      {
        assets: [listAsset],
        reviews: [listReview],
        reviewDetails: detail ? { [reviewId]: detail } : {},
        assessmentsByReview: assessments
          ? { [reviewId]: assessments }
          : {},
        sensorCriticalByAsset,
      },
      reviewId,
    );
  }, [listReview, listAsset, detail, assessments, reviewId, sensorCriticalByAsset]);

  const assessmentList = assessments ?? [];
  const latest = useMemo(() => {
    if (!assessmentList.length) return null;
    const inFlight = assessmentList.find(
      (a) => a.status === "pending" || a.status === "generating",
    );
    if (inFlight) return inFlight;
    return (
      assessmentList.find((a) => a.status === "complete") ??
      assessmentList.find((a) => a.status === "failed") ??
      assessmentList[0]
    );
  }, [assessmentList]);

  const assessmentInProgress =
    (detail?.review.state ?? listReview?.state) === "assessing" ||
    latest?.status === "pending" ||
    latest?.status === "generating";

  const priorAssessment = assessmentInProgress
    ? priorSettledAssessment(assessmentList)
    : null;

  if (loadError && !detail) {
    return (
      <div className={styles.missing} data-variant={variant}>
        <p>Could not load review: {loadError}</p>
      </div>
    );
  }

  if (!detail || !view) {
    return (
      <div className={styles.missing} data-variant={variant}>
        <p className={styles.loading}>Loading review…</p>
      </div>
    );
  }

  const { review, asset } = detail;
  const decision = detail.decision ?? null;
  const recommendations = latest?.recommendations ?? [];
  const otherRecommendations = recommendations.slice(1);
  const nextAction = nextActionForView(view);
  const ownerName = ownerNameForView(view);
  const showRecommended =
    !supervisorAudience &&
    (latest?.status === "complete" || recommendations.length > 0);

  return (
    <div className={styles.detail} data-variant={variant}>
      {!embedded && (
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>{asset.name}</h1>
            <p className={styles.subtitle}>
              Triggered by {review.triggered_by.replaceAll("_", " ")} · created{" "}
              {new Date(review.created_at).toLocaleString()}
              {review.origin === "supervisor" ? (
                <>
                  {" "}
                  · <span className="badge">
                    Supervisor raised · {detail.raised_by_worker_name ?? "Unknown"}
                  </span>
                </>
              ) : null}
              {detail.area_owner
                ? ` · Area owner ${detail.area_owner.name}`
                : ""}
            </p>
          </div>
          <div className={styles.badges}>
            <span className="badge">{review.state.replaceAll("_", " ")}</span>
            <span className="badge" data-risk={view.risk_level}>
              {view.risk_level}
            </span>
          </div>
        </header>
      )}

      {!supervisorAudience && assessmentInProgress ? (
        <AssessingBanner
          priorRisk={priorAssessment?.risk_level ?? null}
          provisionalRisk={openWorkDisplayRisk(
            view.risk_level,
            view.sensor_critical,
          )}
          sensorCritical={view.sensor_critical}
        />
      ) : null}

      <IssueReport
        view={view}
        assessment={
          (assessmentInProgress ? priorAssessment : latest) as
            | AssessmentHistoryItem
            | null
        }
        inProgress={assessmentInProgress && priorAssessment == null}
        summaryOnly={supervisorAudience}
      />

      {showRecommended && !assessmentInProgress && (
        <section
          className={actionStyles.actionSection}
          aria-labelledby="review-do-heading"
        >
          <h3 id="review-do-heading" className={actionStyles.actionSectionTitle}>
            Recommended action
          </h3>

          <div className={actionStyles.primaryAction} data-risk={view.risk_level}>
            <div className={actionStyles.primaryActionTop}>
              <span className={actionStyles.primaryActionEyebrow}>Do next</span>
              {ownerName ? (
                <span className={actionStyles.primaryActionOwner}>
                  Owner · <strong>{ownerName}</strong>
                </span>
              ) : null}
            </div>
            <p className={actionStyles.primaryActionText}>{nextAction}</p>
          </div>

          {decision ? (
            <p className={actionStyles.decisionLine}>
              <span
                className="badge"
                data-risk={
                  decision.outcome === "blocked"
                    ? "blocking"
                    : decision.outcome === "approved_with_conditions"
                      ? "elevated"
                      : "nominal"
                }
              >
                {decision.outcome.replaceAll("_", " ")}
              </span>
              {decision.conditions ? ` — ${decision.conditions}` : ""}
            </p>
          ) : otherRecommendations.length > 0 ? (
            <details
              className={actionStyles.candidates}
              open={otherActionsOpen}
              onToggle={(e) =>
                setOtherActionsOpen((e.target as HTMLDetailsElement).open)
              }
            >
              <summary className={actionStyles.candidatesSummary}>
                <span>Candidate actions</span>
                <span className={actionStyles.candidatesCount}>
                  {otherRecommendations.length}
                </span>
              </summary>
              <ol className={actionStyles.candidateList}>
                {otherRecommendations.map((rec, i) => (
                  <li key={rec.id} className={actionStyles.candidateItem}>
                    <span className={actionStyles.candidateIndex} aria-hidden>
                      {i + 2}
                    </span>
                    <div className={actionStyles.candidateBody}>
                      <p className={actionStyles.candidateText}>{rec.text}</p>
                      {rec.rationale && (
                        <p className={actionStyles.candidateRationale}>
                          {rec.rationale}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </section>
      )}

      {!supervisorAudience ? (
        <>
          <AgentTracePanel
            reviewId={review.id}
            assessment={latest as AssessmentHistoryItem | null}
            inProgress={assessmentInProgress}
          />

          <AssessmentPanel
            reviewId={review.id}
            reviewState={review.state}
            assessment={latest as AssessmentHistoryItem | null}
            inProgress={assessmentInProgress}
            reassessing={priorAssessment != null}
          />
        </>
      ) : null}

      {!embedded && (
        <DecisionCard title="Decision">
          <DecisionPanel
            reviewId={review.id}
            reviewState={review.state}
            assessment={latest}
            existing={detail.decision}
            areaOwner={detail.area_owner}
            taskSummary={detail.task_summary}
          />
        </DecisionCard>
      )}

      <ReviewThread reviewId={review.id} />
    </div>
  );
}
