"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  findViewByReviewId,
  spatialLinksFromAssessment,
  useLiveStore,
} from "@/lib/liveStore";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import {
  buildReasoningGraphFromDetail,
  type ReasoningGraphNode,
} from "@/lib/reasoningGraph";
import { ReasoningGraph } from "@/components/trace/ReasoningGraph";
import { ReasoningGraphInspector } from "@/components/trace/ReasoningGraphInspector";
import { AssessmentPanel } from "@/components/assessment/AssessmentPanel";
import { DecisionPanel } from "@/components/decision/DecisionPanel";
import styles from "./ReviewDetail.module.css";

interface ReviewDetailProps {
  reviewId: string;
}

export function ReviewDetail({ reviewId }: ReviewDetailProps) {
  const loadReviewDetail = useLiveStore((s) => s.loadReviewDetail);
  const assets = useLiveStore((s) => s.assets);
  const reviews = useLiveStore((s) => s.reviews);
  const reviewDetails = useLiveStore((s) => s.reviewDetails);
  const assessmentsByReview = useLiveStore((s) => s.assessmentsByReview);
  const agentSteps = useLiveStore((s) => s.agentSteps);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<ReasoningGraphNode | null>(
    null,
  );

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

  const graphData = useMemo(() => {
    if (!detail) {
      return { nodes: [], edges: [] };
    }
    const spatialLinks = spatialLinksFromAssessment(latest);
    const steps = agentSteps.filter((s) => s.review_id === reviewId);
    return buildReasoningGraphFromDetail(
      detail,
      latest,
      spatialLinks,
      steps,
    );
  }, [detail, latest, agentSteps, reviewId]);

  useEffect(() => {
    setSelectedNode(null);
  }, [reviewId]);

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
        <p className={styles.loading}>Loading review…</p>
        <Link href="/">← Back to Digital Twin</Link>
      </div>
    );
  }

  const { review, asset } = detail;

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <div>
          <p className={styles.crumb}>
            <Link href="/">Digital Twin</Link> / {review.id.slice(0, 8)}…
          </p>
          <h1 className={styles.title}>{asset.name}</h1>
          <p className={styles.subtitle}>
            Triggered by {review.triggered_by} · created{" "}
            {new Date(review.created_at).toLocaleString()}
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

      <div className={styles.graphLayout}>
        <div className={styles.graphPane}>
          <h3 className={styles.panelTitle}>Reasoning graph</h3>
          <ReasoningGraph
            data={graphData}
            selectedId={selectedNode?.id ?? null}
            onSelect={setSelectedNode}
          />
        </div>
        <ReasoningGraphInspector
          node={selectedNode}
          fallbackSummary={latest?.summary ?? null}
          fallbackRisk={
            (latest?.risk_level as string | null | undefined) ??
            view.risk_level
          }
        />
      </div>

      <div className={styles.sideRow}>
        <AssessmentPanel
          reviewId={review.id}
          reviewState={review.state}
          assessment={latest as AssessmentHistoryItem | null}
        />
        <DecisionPanel
          reviewId={review.id}
          reviewState={review.state}
          assessment={latest}
          existing={detail.decision}
        />
      </div>
    </div>
  );
}
