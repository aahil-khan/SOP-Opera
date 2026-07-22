"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import type { LiveAssetView } from "@/lib/liveStore";
import { useLiveStore } from "@/lib/liveStore";
import { useTourStepId } from "@/lib/tourStore";
import { AgentBrainPanel } from "./AgentBrainPanel";
import { WhyBrief } from "./WhyBrief";
import { DecisionPanel } from "@/components/decision/DecisionPanel";
import { DecisionCard } from "@/components/decision/DecisionCard";
import type { AreaOwner } from "@/shared/schemas";
import type { TaskSummary } from "@/lib/liveApi";
import {
  AssessingBanner,
  priorSettledAssessment,
} from "@/components/assessment/AssessingBanner";
import { nextActionForView, ownerNameForView, workStatusForView } from "@/lib/openWork";
import { openWorkDisplayRisk } from "@/lib/sensorThresholds";
import { useHorizontalResize } from "./useHorizontalResize";
import actionStyles from "@/components/decision/RecommendedAction.module.css";
import styles from "./AssetPanel.module.css";

const ReviewDetail = dynamic(
  () =>
    import("@/components/reviews/ReviewDetail").then((m) => m.ReviewDetail),
  {
    ssr: false,
    loading: () => (
      <p className={styles.loadingHint}>Loading full review…</p>
    ),
  },
);

const DomainRadar = dynamic(
  () => import("./DomainRadar").then((m) => m.DomainRadar),
  { ssr: false },
);

const TrendForecastCard = dynamic(
  () => import("./TrendForecastCard").then((m) => m.TrendForecastCard),
  { ssr: false },
);

interface AssetPanelProps {
  view: LiveAssetView;
  onClose: () => void;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
}

const EXIT_MS = 160;

function scrollSectionIntoView(body: HTMLElement, section: HTMLElement) {
  const run = () => {
    const delta =
      section.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTo({
      top: Math.max(0, body.scrollTop + delta),
      behavior: "smooth",
    });
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
  window.setTimeout(run, 50);
  window.setTimeout(run, 240);
}

function QuickDecisionSection({
  open,
  onClose,
  reviewId,
  reviewState,
  assessment,
  existing,
  bodyRef,
  areaOwner,
  taskSummary,
}: {
  open: boolean;
  onClose: () => void;
  reviewId: string;
  reviewState: string;
  assessment: LiveAssetView["assessment"];
  existing: NonNullable<LiveAssetView["detail"]>["decision"] | null;
  bodyRef: RefObject<HTMLDivElement | null>;
  areaOwner: AreaOwner | null;
  taskSummary?: TaskSummary | null;
}) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderedRef = useRef(open);

  useEffect(() => {
    renderedRef.current = rendered;
  }, [rendered]);

  useEffect(() => {
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }

    if (!open) {
      if (!renderedRef.current) return;
      setClosing(true);
      exitTimer.current = setTimeout(() => {
        setRendered(false);
        setClosing(false);
      }, EXIT_MS);
      return () => {
        if (exitTimer.current) clearTimeout(exitTimer.current);
      };
    }

    setClosing(false);
    setRendered(true);
  }, [open]);

  // Scroll only after the section is actually mounted (rendered flips true
  // in a later effect, so we must depend on `rendered` — not just `open`).
  useEffect(() => {
    if (!open || !rendered || closing) return;
    const body = bodyRef.current;
    const section = sectionRef.current;
    if (!body || !section) return;
    scrollSectionIntoView(body, section);
  }, [open, rendered, closing, bodyRef]);

  if (!rendered) return null;

  return (
    <DecisionCard
      cardRef={sectionRef}
      title="Make a decision"
      onClose={onClose}
      closing={closing}
      data-tour="decision"
    >
      <DecisionPanel
        reviewId={reviewId}
        reviewState={reviewState}
        assessment={assessment}
        existing={existing}
        areaOwner={areaOwner}
        taskSummary={taskSummary}
      />
    </DecisionCard>
  );
}

export function AssetPanel({
  view,
  onClose,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  onResizingChange,
}: AssetPanelProps) {
  const { asset, risk_level, sensor_critical, review, assessment, detail } = view;
  const decision = detail?.decision ?? null;
  const recommendations = assessment?.recommendations ?? [];
  const nextAction = nextActionForView(view);
  const ownerName = ownerNameForView(view);
  const [otherActionsOpen, setOtherActionsOpen] = useState(true);
  const [quickDecisionOpen, setQuickDecisionOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const { resizing, handleProps } = useHorizontalResize({
    width,
    onWidthChange,
    minWidth,
    maxWidth,
    edge: "w",
  });

  useEffect(() => {
    onResizingChange?.(resizing);
  }, [resizing, onResizingChange]);

  const assetPanelMode = useLiveStore((s) => s.assetPanelMode);
  const setAssetPanelMode = useLiveStore((s) => s.setAssetPanelMode);
  const loadReviewDetail = useLiveStore((s) => s.loadReviewDetail);
  const assessmentHistory = useLiveStore((s) =>
    review ? s.assessmentsByReview[review.id] : undefined,
  );
  const isFullReview = assetPanelMode === "fullReview";
  const tourStepId = useTourStepId();
  /** Tour Act III needs the Brain even after a fast mock assessment finishes. */
  const tourShowBrain = tourStepId === "cast-brain";
  /** Act V opens the decision form (not the sticky footer / full-review chrome). */
  const tourShowDecision = tourStepId === "verdict";

  useEffect(() => {
    if (!tourShowDecision) return;
    setAssetPanelMode("summary");
    setQuickDecisionOpen(true);
  }, [tourShowDecision, setAssetPanelMode]);

  const assessmentInProgress =
    review?.state === "assessing" ||
    assessment?.status === "pending" ||
    assessment?.status === "generating";
  const showBrain = Boolean(review && (assessmentInProgress || tourShowBrain));

  const priorAssessment = assessmentInProgress
    ? priorSettledAssessment(assessmentHistory) ??
      (assessment?.status === "complete" || assessment?.status === "failed"
        ? assessment
        : null)
    : null;
  const provisionalDisplayRisk = openWorkDisplayRisk(risk_level, sensor_critical);

  const openReview =
    review != null &&
    review.state !== "closed" &&
    review.state !== "decided";

  const reviewClosed = review?.state === "closed";
  const workStatus = workStatusForView(view);

  /** Healthy asset — no review at all. Closed incidents keep their story. */
  const isHappy = !assessmentInProgress && !openReview && !review;

  const otherRecommendations = recommendations.slice(1);

  useEffect(() => {
    setQuickDecisionOpen(false);
    setOtherActionsOpen(true);
  }, [asset.id, review?.id]);

  useEffect(() => {
    if (isFullReview) setQuickDecisionOpen(false);
  }, [isFullReview]);

  useEffect(() => {
    if (assessmentInProgress) setQuickDecisionOpen(false);
  }, [assessmentInProgress]);

  useEffect(() => {
    if (!quickDecisionOpen || !review) return;
    void loadReviewDetail(review.id);
  }, [quickDecisionOpen, review, loadReviewDetail]);

  // Closed reviews are skipped at bootstrap — load decision + assessment on select.
  useEffect(() => {
    if (!review || review.state !== "closed") return;
    if (detail != null) return;
    void loadReviewDetail(review.id);
  }, [review, detail, loadReviewDetail]);

  return (
    <aside
      className={styles.drawer}
      data-mode={assetPanelMode}
      data-resizing={resizing ? "true" : undefined}
      aria-label={
        isFullReview ? `${asset.name} full review` : `${asset.name} detail`
      }
    >
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize asset panel"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        {...handleProps}
      />
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>{asset.name}</h2>
          <p className={styles.subtitle}>
            <span className="badge" data-risk={workStatus.badgeRisk}>
              {workStatus.label}
            </span>
            {sensor_critical && !workStatus.resolved ? (
              <span className={styles.criticalBadge}>sensor critical</span>
            ) : null}
            {review && !isHappy && !reviewClosed && (
              <span className="badge">
                {review.state.replaceAll("_", " ")}
              </span>
            )}
          </p>
          {review && !isHappy && !isFullReview && (
            <p className={styles.trigger} data-risk={risk_level}>
              {review.origin === "supervisor" ? (
                <span className="badge">
                  Supervisor raised · {detail?.raised_by_worker_name ?? "Unknown"}
                </span>
              ) : null}
              <span className={styles.triggerLabel}>Triggered by</span>
              <span className={styles.triggerValue}>
                {review.triggered_by.replaceAll("_", " ")}
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close panel"
        >
          ×
        </button>
      </header>

      <div className={styles.body} ref={bodyRef}>
        {isFullReview && review ? (
          <ReviewDetail reviewId={review.id} variant="embedded" />
        ) : (
          <>
            {isHappy ? (
              <section className={styles.happyState} aria-label="Asset status">
                <div className={styles.happyOrb} aria-hidden>
                  <span className={styles.happyPulse} />
                  <svg
                    className={styles.happyFace}
                    viewBox="0 0 40 40"
                    width="40"
                    height="40"
                  >
                    <circle
                      className={styles.happyFaceBg}
                      cx="20"
                      cy="20"
                      r="18"
                    />
                    <circle
                      className={styles.happyEye}
                      cx="14"
                      cy="16"
                      r="2.2"
                    />
                    <circle
                      className={styles.happyEye}
                      cx="26"
                      cy="16"
                      r="2.2"
                    />
                    <path
                      className={styles.happySmile}
                      d="M13 23c2.2 3.2 11.8 3.2 14 0"
                      fill="none"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <h3 className={styles.happyTitle}>All clear</h3>
                <p className={styles.happyCopy}>
                  {asset.name} is operating normally. Check domains below for
                  relevant information.
                </p>
              </section>
            ) : (
              <section
                className={styles.whyCard}
                data-risk={workStatus.badgeRisk}
                aria-labelledby="why-heading"
              >
                <h3 id="why-heading" className={styles.sectionTitle}>
                  {reviewClosed ? "What happened" : "Why"}
                </h3>
                {showBrain && review ? (
                  <>
                    {assessmentInProgress ? (
                      <AssessingBanner
                        priorRisk={priorAssessment?.risk_level ?? null}
                        provisionalRisk={provisionalDisplayRisk}
                        sensorCritical={sensor_critical}
                      />
                    ) : null}
                    <AgentBrainPanel reviewId={review.id} />
                  </>
                ) : (
                  <>
                    <WhyBrief view={view} assessment={assessment} />
                    {reviewClosed && decision ? (
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
                    ) : null}
                  </>
                )}
              </section>
            )}

            {!showBrain && <DomainRadar view={view} />}

            {!isHappy && (
              <TrendForecastCard
                assessment={assessment}
                reviewId={review?.id}
              />
            )}

            {!isHappy && !showBrain && !reviewClosed && (
              <section
                className={actionStyles.actionSection}
                aria-labelledby="do-heading"
              >
                <h3 id="do-heading" className={actionStyles.actionSectionTitle}>
                  Recommended action
                </h3>

                <div className={actionStyles.primaryAction} data-risk={risk_level}>
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
                      setOtherActionsOpen(
                        (e.target as HTMLDetailsElement).open,
                      )
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
          </>
        )}

        {review && !isHappy && !reviewClosed && (
          <QuickDecisionSection
            open={quickDecisionOpen}
            onClose={() => setQuickDecisionOpen(false)}
            reviewId={review.id}
            reviewState={review.state}
            assessment={assessment}
            existing={decision}
            areaOwner={detail?.area_owner ?? null}
            taskSummary={detail?.task_summary ?? null}
            bodyRef={bodyRef}
          />
        )}
      </div>

      {review && !isHappy && (
        <div
          className={styles.footer}
          data-single-action={assessmentInProgress || reviewClosed ? "true" : undefined}
        >
          {!assessmentInProgress && !reviewClosed && (
            <button
              type="button"
              className={`btn ${styles.footerBtn}`}
              aria-expanded={quickDecisionOpen}
              onClick={() => setQuickDecisionOpen((open) => !open)}
            >
              Make a decision
            </button>
          )}
          {isFullReview ? (
            <button
              type="button"
              className={`btn btn-primary ${styles.footerBtn}`}
              onClick={() => {
                setQuickDecisionOpen(false);
                setAssetPanelMode("summary");
              }}
            >
              Go back
            </button>
          ) : (
            <button
              type="button"
              className={`btn btn-primary ${styles.footerBtn}`}
              onClick={() => setAssetPanelMode("fullReview")}
            >
              View full review
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
