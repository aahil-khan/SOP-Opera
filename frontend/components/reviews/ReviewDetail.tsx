"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  findViewByReviewId,
  useLiveStore,
} from "@/lib/liveStore";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import { ReasoningTrace } from "@/components/trace/ReasoningTrace";
import { AssessmentPanel } from "@/components/assessment/AssessmentPanel";
import { DecisionPanel } from "@/components/decision/DecisionPanel";
import styles from "./ReviewDetail.module.css";

interface ReviewDetailProps {
  reviewId: string;
}

function toTraceAssessment(a: AssessmentHistoryItem | null) {
  if (!a) return null;
  return {
    id: a.id,
    review_id: a.review_id,
    assessment_type: a.assessment_type,
    status: a.status,
    risk_level: (a.risk_level ?? "elevated") as
      | "nominal"
      | "elevated"
      | "blocking",
    summary: a.summary ?? "",
    recommendations: a.recommendations,
    derived_fact_ids: a.derived_fact_ids,
    metadata: a.metadata
      ? {
          provider: a.metadata.provider,
          model: a.metadata.model ?? "",
          prompt_version: a.metadata.prompt_version ?? "",
          input_tokens: a.metadata.input_tokens ?? 0,
          output_tokens: a.metadata.output_tokens ?? 0,
          estimated_cost_usd: a.metadata.estimated_cost_usd ?? 0,
          latency_ms: a.metadata.latency_ms ?? 0,
          timestamp: a.created_at ?? new Date().toISOString(),
          retrieved_context_ids: a.metadata.retrieved_context_ids ?? [],
          retrieved_evidence_ids: a.metadata.retrieved_evidence_ids ?? [],
          retrieval_mode: a.metadata.retrieval_mode ?? "skipped",
          retrieval_quality: a.metadata.retrieval_quality ?? "n_a",
          retrieval_score: a.metadata.retrieval_score ?? null,
          embedding_model: a.metadata.embedding_model ?? null,
          confidence: a.metadata.confidence ?? 0,
          assessment_version:
            a.metadata.assessment_version ?? a.version,
        }
      : null,
  };
}

export function ReviewDetail({ reviewId }: ReviewDetailProps) {
  const loadReviewDetail = useLiveStore((s) => s.loadReviewDetail);
  const assets = useLiveStore((s) => s.assets);
  const reviews = useLiveStore((s) => s.reviews);
  const reviewDetails = useLiveStore((s) => s.reviewDetails);
  const assessmentsByReview = useLiveStore((s) => s.assessmentsByReview);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadReviewDetail(reviewId).catch((err: Error) => {
      if (!cancelled) setLoadError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [reviewId, loadReviewDetail]);

  const view = findViewByReviewId(
    { assets, reviews, reviewDetails, assessmentsByReview },
    reviewId,
  );
  const detail = reviewDetails[reviewId];
  const assessments = assessmentsByReview[reviewId] ?? [];
  const latest = useMemo(() => {
    if (!assessments.length) return null;
    return (
      assessments.find((a) => a.status === "complete") ??
      assessments.find((a) => a.status === "failed") ??
      assessments[0]
    );
  }, [assessments]);

  if (loadError && !detail) {
    return (
      <div className={styles.missing}>
        <p>Could not load review: {loadError}</p>
        <Link href="/">← Back to Digital Twin</Link>
      </div>
    );
  }

  if (!detail || !view) {
    return (
      <div className={styles.missing}>
        <p style={{ color: "var(--muted)" }}>Loading review…</p>
        <Link href="/">← Back to Digital Twin</Link>
      </div>
    );
  }

  const { review, asset } = detail;

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.8rem" }}>
            <Link href="/">Digital Twin</Link> / {review.id.slice(0, 8)}…
          </p>
          <h1 className={styles.title}>{asset.name}</h1>
          <p className={styles.subtitle}>
            Triggered by {review.triggered_by} · created{" "}
            {new Date(review.created_at).toLocaleString()}
          </p>
        </div>
        <div className={styles.badges}>
          <span className="badge">{review.state.replaceAll("_", " ")}</span>
          <span className="badge" data-risk={view.risk_level}>
            {view.risk_level}
          </span>
        </div>
      </header>

      <div className={styles.grid}>
        <div className="panel">
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Reasoning trace</h3>
          <ReasoningTrace
            asset={asset}
            context={detail.context}
            derivedFacts={detail.derived_facts}
            references={latest?.retrieved_references ?? []}
            assessment={toTraceAssessment(latest)}
            decision={detail.decision}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <AssessmentPanel
            reviewId={review.id}
            reviewState={review.state}
            assessment={latest}
          />
          <DecisionPanel
            reviewId={review.id}
            reviewState={review.state}
            assessment={latest}
            existing={detail.decision}
          />
        </div>
      </div>
    </div>
  );
}
