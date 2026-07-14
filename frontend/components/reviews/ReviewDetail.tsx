"use client";

import Link from "next/link";
import {
  findRuntimeByReviewId,
  useDemoStore,
} from "@/lib/demoStore";
import { ReasoningTrace } from "@/components/trace/ReasoningTrace";
import { AssessmentPanel } from "@/components/assessment/AssessmentPanel";
import { DecisionPanel } from "@/components/decision/DecisionPanel";
import styles from "./ReviewDetail.module.css";

interface ReviewDetailProps {
  reviewId: string;
}

export function ReviewDetail({ reviewId }: ReviewDetailProps) {
  const runtimes = useDemoStore((s) => s.runtimes);
  const runtime = findRuntimeByReviewId(runtimes, reviewId);

  if (!runtime || !runtime.review) {
    return (
      <div className={styles.missing}>
        <p>Review not found.</p>
        <Link href="/">← Back to Digital Twin</Link>
      </div>
    );
  }

  const { review, asset } = runtime;

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
          <span className="badge" data-risk={runtime.risk_level}>
            {runtime.risk_level}
          </span>
        </div>
      </header>

      <div className={styles.grid}>
        <div className="panel">
          <h3 style={{ marginTop: 0, fontSize: "1rem" }}>Reasoning trace</h3>
          <ReasoningTrace
            asset={asset}
            context={runtime.context}
            derivedFacts={runtime.derived_facts}
            references={runtime.references}
            assessment={runtime.assessment}
            decision={runtime.decision}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <AssessmentPanel assessment={runtime.assessment} />
          <DecisionPanel
            reviewId={review.id}
            assessment={runtime.assessment}
            existing={runtime.decision}
          />
        </div>
      </div>
    </div>
  );
}
