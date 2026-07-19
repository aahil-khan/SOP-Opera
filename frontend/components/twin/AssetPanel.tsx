"use client";

import { useState } from "react";
import Link from "next/link";
import type { LiveAssetView } from "@/lib/liveStore";
import { AgentBrainPanel } from "./AgentBrainPanel";
import { DomainRadar } from "./DomainRadar";
import { nextActionForView, ownerNameForView } from "@/lib/openWork";
import styles from "./AssetPanel.module.css";

interface AssetPanelProps {
  view: LiveAssetView;
  onClose: () => void;
}

const WHY_CLAMP_CHARS = 220;

export function AssetPanel({ view, onClose }: AssetPanelProps) {
  const { asset, risk_level, review, assessment, detail } = view;
  const decision = detail?.decision ?? null;
  const areaOwner = detail?.area_owner ?? null;
  const recommendations = assessment?.recommendations ?? [];
  const nextAction = nextActionForView(view);
  const ownerName = ownerNameForView(view);
  const [whyExpanded, setWhyExpanded] = useState(false);
  const [otherActionsOpen, setOtherActionsOpen] = useState(false);

  const assessmentInProgress =
    review?.state === "assessing" ||
    assessment?.status === "pending" ||
    assessment?.status === "generating";

  const summary =
    assessment?.summary ??
    (assessmentInProgress
      ? "Assessment in progress…"
      : review
        ? "No assessment summary yet."
        : "No open review for this asset.");

  const whyLong = summary.length > WHY_CLAMP_CHARS;
  const whyShown =
    whyLong && !whyExpanded
      ? `${summary.slice(0, WHY_CLAMP_CHARS).trimEnd()}…`
      : summary;

  // First recommendation already surfaces as "Next" — only show the rest.
  const otherRecommendations = recommendations.slice(1);

  return (
    <aside className={styles.drawer} aria-label={`${asset.name} detail`}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.title}>{asset.name}</h2>
          <p className={styles.subtitle}>
            <span>{asset.zone}</span>
            <span className="badge" data-risk={risk_level}>
              {risk_level}
            </span>
            {review && (
              <span className="badge">
                {review.state.replaceAll("_", " ")}
              </span>
            )}
          </p>
          {areaOwner && (
            <p className={styles.ownerLine}>
              Area owner · <strong>{areaOwner.name}</strong> ({areaOwner.role})
            </p>
          )}
          {review && (
            <p className={styles.trigger}>
              Triggered by {review.triggered_by.replaceAll("_", " ")}
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

      <div className={styles.body}>
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
              <p className={styles.summary}>Assessment in progress…</p>
              <AgentBrainPanel reviewId={review.id} />
            </>
          ) : (
            <>
              <p className={styles.summary}>{whyShown}</p>
              {whyLong && (
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setWhyExpanded((v) => !v)}
                >
                  {whyExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </>
          )}
        </section>

        {!assessmentInProgress && <DomainRadar view={view} />}

        <section className={styles.section} aria-labelledby="do-heading">
          <h3 id="do-heading" className={styles.sectionTitle}>
            Recommended action
          </h3>
          <div className={styles.nextOwnerCard}>
            <p className={styles.nextOwnerLine}>
              <span className={styles.nextOwnerLabel}>Next</span>
              {nextAction}
            </p>
            {ownerName ? (
              <p className={styles.nextOwnerLine}>
                <span className={styles.nextOwnerLabel}>Owner</span>
                {ownerName}
              </p>
            ) : null}
          </div>

          {decision ? (
            <p className={styles.decisionLine}>
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
              className={styles.otherActions}
              open={otherActionsOpen}
              onToggle={(e) =>
                setOtherActionsOpen((e.target as HTMLDetailsElement).open)
              }
            >
              <summary className={styles.otherActionsSummary}>
                {otherRecommendations.length} other candidate action
                {otherRecommendations.length === 1 ? "" : "s"}
              </summary>
              <ul className={styles.list}>
                {otherRecommendations.map((rec) => (
                  <li key={rec.id} className={styles.recItem}>
                    <p className={styles.recText}>{rec.text}</p>
                    {rec.rationale && (
                      <p className={styles.recRationale}>{rec.rationale}</p>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </div>

      {review && (
        <div className={styles.footer}>
          <Link
            className={`btn btn-primary ${styles.footerLink}`}
            href={`/reviews/${review.id}`}
          >
            View full review
          </Link>
        </div>
      )}
    </aside>
  );
}
