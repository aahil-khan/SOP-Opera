"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import type { LiveAssetView } from "@/lib/liveStore";
import { useLiveStore } from "@/lib/liveStore";
import { AgentBrainPanel } from "./AgentBrainPanel";
import { DomainRadar } from "./DomainRadar";
import { WhyBrief } from "./WhyBrief";
import { DecisionPanel } from "@/components/decision/DecisionPanel";
import { DecisionCard } from "@/components/decision/DecisionCard";
import { nextActionForView, ownerNameForView } from "@/lib/openWork";
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

interface AssetPanelProps {
  view: LiveAssetView;
  onClose: () => void;
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
}: {
  open: boolean;
  onClose: () => void;
  reviewId: string;
  reviewState: string;
  assessment: LiveAssetView["assessment"];
  existing: NonNullable<LiveAssetView["detail"]>["decision"] | null;
  bodyRef: RefObject<HTMLDivElement | null>;
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
    >
      <DecisionPanel
        reviewId={reviewId}
        reviewState={reviewState}
        assessment={assessment}
        existing={existing}
      />
    </DecisionCard>
  );
}

export function AssetPanel({ view, onClose }: AssetPanelProps) {
  const { asset, risk_level, review, assessment, detail } = view;
  const decision = detail?.decision ?? null;
  const recommendations = assessment?.recommendations ?? [];
  const nextAction = nextActionForView(view);
  const ownerName = ownerNameForView(view);
  const [otherActionsOpen, setOtherActionsOpen] = useState(true);
  const [quickDecisionOpen, setQuickDecisionOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const assetPanelMode = useLiveStore((s) => s.assetPanelMode);
  const setAssetPanelMode = useLiveStore((s) => s.setAssetPanelMode);
  const loadReviewDetail = useLiveStore((s) => s.loadReviewDetail);
  const isFullReview = assetPanelMode === "fullReview";

  const assessmentInProgress =
    review?.state === "assessing" ||
    assessment?.status === "pending" ||
    assessment?.status === "generating";

  const openReview =
    review != null &&
    review.state !== "closed" &&
    review.state !== "decided";

  /** Healthy asset — no open incident work. Keep domains for live context. */
  const isHappy =
    risk_level === "nominal" && !assessmentInProgress && !openReview;

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

  return (
    <aside
      className={styles.drawer}
      data-mode={assetPanelMode}
      aria-label={
        isFullReview ? `${asset.name} full review` : `${asset.name} detail`
      }
    >
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>{asset.name}</h2>
          <p className={styles.subtitle}>
            <span className="badge" data-risk={risk_level}>
              {risk_level}
            </span>
            {review && !isHappy && (
              <span className="badge">
                {review.state.replaceAll("_", " ")}
              </span>
            )}
          </p>
          {review && !isHappy && !isFullReview && (
            <p className={styles.trigger} data-risk={risk_level}>
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
                data-risk={risk_level}
                aria-labelledby="why-heading"
              >
                <h3 id="why-heading" className={styles.sectionTitle}>
                  Why
                </h3>
                {assessmentInProgress && review ? (
                  <>
                    <div
                      className={styles.assessingBanner}
                      aria-live="polite"
                      aria-busy="true"
                    >
                      <span className={styles.assessingSpinner} aria-hidden />
                      <div className={styles.assessingCopy}>
                        <p className={styles.assessingTitle}>
                          Generating assessment
                        </p>
                        <p className={styles.assessingHint}>
                          Domain agents are analyzing signals and drafting a
                          recommendation. This usually takes a few moments.
                        </p>
                      </div>
                    </div>
                    <AgentBrainPanel reviewId={review.id} />
                  </>
                ) : (
                  <WhyBrief view={view} assessment={assessment} />
                )}
              </section>
            )}

            {!assessmentInProgress && <DomainRadar view={view} />}

            {!isHappy && !assessmentInProgress && (
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

        {review && !isHappy && (
          <QuickDecisionSection
            open={quickDecisionOpen}
            onClose={() => setQuickDecisionOpen(false)}
            reviewId={review.id}
            reviewState={review.state}
            assessment={assessment}
            existing={decision}
            bodyRef={bodyRef}
          />
        )}
      </div>

      {review && !isHappy && (
        <div className={styles.footer}>
          {!assessmentInProgress && (
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
