"use client";

import Link from "next/link";
import type { LiveAssetView } from "@/lib/liveStore";
import { ReasoningTrace } from "@/components/trace/ReasoningTrace";
import styles from "./AssetPanel.module.css";

interface AssetPanelProps {
  view: LiveAssetView;
  onClose: () => void;
}

export function AssetPanel({ view, onClose }: AssetPanelProps) {
  const { asset, risk_level, review, assessment, detail } = view;
  const context = detail?.context ?? [];
  const derivedFacts = detail?.derived_facts ?? [];
  const decision = detail?.decision ?? null;
  const references = assessment?.retrieved_references ?? [];

  // Map history item → Assessment shape for the trace (nullable fields).
  const assessmentForTrace =
    assessment && assessment.status === "complete" && assessment.risk_level
      ? {
          id: assessment.id,
          review_id: assessment.review_id,
          assessment_type: assessment.assessment_type,
          status: assessment.status,
          risk_level: assessment.risk_level,
          summary: assessment.summary ?? "",
          recommendations: assessment.recommendations,
          derived_fact_ids: assessment.derived_fact_ids,
          metadata: assessment.metadata
            ? {
                provider: assessment.metadata.provider,
                model: assessment.metadata.model ?? "",
                prompt_version: assessment.metadata.prompt_version ?? "",
                input_tokens: assessment.metadata.input_tokens ?? 0,
                output_tokens: assessment.metadata.output_tokens ?? 0,
                estimated_cost_usd:
                  assessment.metadata.estimated_cost_usd ?? 0,
                latency_ms: assessment.metadata.latency_ms ?? 0,
                timestamp: assessment.created_at ?? new Date().toISOString(),
                retrieved_context_ids:
                  assessment.metadata.retrieved_context_ids ?? [],
                retrieved_evidence_ids:
                  assessment.metadata.retrieved_evidence_ids ?? [],
                retrieval_mode: assessment.metadata.retrieval_mode ?? "skipped",
                retrieval_quality:
                  assessment.metadata.retrieval_quality ?? "n_a",
                retrieval_score: assessment.metadata.retrieval_score ?? null,
                embedding_model: assessment.metadata.embedding_model ?? null,
                confidence: assessment.metadata.confidence ?? 0,
                assessment_version:
                  assessment.metadata.assessment_version ??
                  assessment.version,
              }
            : null,
        }
      : assessment && assessment.status !== "complete"
        ? {
            id: assessment.id,
            review_id: assessment.review_id,
            assessment_type: assessment.assessment_type,
            status: assessment.status,
            risk_level: (assessment.risk_level ?? "elevated") as
              | "nominal"
              | "elevated"
              | "blocking",
            summary: assessment.summary ?? "Assessment in progress…",
            recommendations: assessment.recommendations,
            derived_fact_ids: assessment.derived_fact_ids,
            metadata: null,
          }
        : null;

  return (
    <aside className={styles.drawer} aria-label={`${asset.name} detail`}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{asset.name}</h2>
          <p className={styles.subtitle}>
            {asset.zone} ·{" "}
            <span className="badge" data-risk={risk_level}>
              {risk_level}
            </span>
          </p>
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
        <section>
          <h3 className={styles.sectionTitle}>Reasoning trace</h3>
          <ReasoningTrace
            asset={asset}
            context={context}
            derivedFacts={derivedFacts}
            references={references}
            assessment={assessmentForTrace}
            decision={decision}
            compact
          />
        </section>

        {decision && (
          <section>
            <h3 className={styles.sectionTitle}>Evidence (frozen)</h3>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "var(--muted)",
              }}
            >
              Context and assessment cited at decision time are frozen as
              Evidence. {context.length} context · {derivedFacts.length} facts ·
              decision {decision.outcome.replaceAll("_", " ")}.
            </p>
          </section>
        )}
      </div>

      {review && (
        <div className={styles.footer}>
          <Link
            className="btn btn-primary"
            href={`/reviews/${review.id}`}
            style={{ width: "100%" }}
          >
            View full review
          </Link>
        </div>
      )}
    </aside>
  );
}
