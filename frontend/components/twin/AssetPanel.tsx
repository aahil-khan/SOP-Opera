"use client";

import Link from "next/link";
import type { LiveAssetView } from "@/lib/liveStore";
import type { ReasoningFactor, RetrievedReference } from "@/shared/schemas";
import { ReasoningTrace } from "@/components/trace/ReasoningTrace";
import styles from "./AssetPanel.module.css";

interface AssetPanelProps {
  view: LiveAssetView;
  onClose: () => void;
}

function ctxSummary(c: {
  category: string;
  payload: Record<string, unknown>;
}): string {
  const p = c.payload;
  if (c.category === "sensor" && typeof p.gas_reading === "number") {
    return `Gas ${p.gas_reading}${typeof p.unit === "string" ? ` ${p.unit}` : ""}`;
  }
  if (c.category === "worker_location") {
    const name =
      typeof p.worker_name === "string"
        ? p.worker_name
        : `Worker ${String(p.worker_id ?? "?").slice(0, 8)}`;
    return `${name} in ${String(p.zone ?? "?")}`;
  }
  if (c.category === "permit") {
    const work =
      typeof p.work_type === "string" ? ` · ${p.work_type.replaceAll("_", " ")}` : "";
    return `Permit ${String(p.permit_id ?? "?")} · ${String(p.status ?? "")}${work}`;
  }
  return c.category;
}

function refLabel(r: RetrievedReference): string {
  if (r.code && r.title) return `${r.code}: ${r.title}`;
  if (r.title) return r.title;
  return r.source.replaceAll("_", " ");
}

function matchLabel(r: RetrievedReference): string {
  if (r.retrieval_path === "rag" && r.score != null) {
    return `RAG · ${r.score.toFixed(2)}`;
  }
  if (r.triggered_by_fact) {
    return `matched · ${r.triggered_by_fact.replaceAll("_", " ")}`;
  }
  return "matched by category";
}

export function AssetPanel({ view, onClose }: AssetPanelProps) {
  const { asset, risk_level, review, assessment, detail } = view;
  const context = detail?.context ?? [];
  const derivedFacts = detail?.derived_facts ?? [];
  const decision = detail?.decision ?? null;
  const areaOwner = detail?.area_owner ?? null;
  const references = assessment?.retrieved_references ?? [];
  const recommendations = assessment?.recommendations ?? [];
  const factors: ReasoningFactor[] =
    assessment?.reasoning_factors ??
    assessment?.metadata?.reasoning_factors ??
    [];

  const summary =
    assessment?.summary ??
    (assessment?.status === "pending" || assessment?.status === "generating"
      ? "Assessment in progress…"
      : review
        ? "No assessment summary yet."
        : "No open review for this asset.");

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
          reasoning_factors: factors,
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
                  assessment.metadata.assessment_version ?? assessment.version,
                reasoning_factors: factors,
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
            reasoning_factors: factors,
            metadata: null,
          }
        : null;

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
        <section className={styles.section} aria-labelledby="why-heading">
          <h3 id="why-heading" className={styles.sectionTitle}>
            Why
          </h3>
          <p className={styles.summary}>{summary}</p>
          {factors.length > 0 && (
            <ul className={styles.factorList}>
              {factors.map((f) => (
                <li key={f.fact_type} className={styles.factorItem}>
                  <strong>{f.headline}</strong>
                  <p>{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="evidence-heading">
          <h3 id="evidence-heading" className={styles.sectionTitle}>
            Evidence
          </h3>
          {derivedFacts.length === 0 &&
          context.length === 0 &&
          references.length === 0 ? (
            <p className={styles.muted}>No evidence available yet.</p>
          ) : (
            <>
              {derivedFacts.length > 0 && (
                <div className={styles.chipRow}>
                  {derivedFacts.map((f) => (
                    <span key={f.id} className={styles.chip} data-highlight="true">
                      {String(f.fact_type).replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              )}
              {context.length > 0 && (
                <ul className={styles.list}>
                  {context.map((c) => (
                    <li
                      key={c.id}
                      className={styles.listItem}
                      data-highlight="true"
                    >
                      {ctxSummary(c)}
                    </li>
                  ))}
                </ul>
              )}
              {references.length > 0 && (
                <ul className={styles.list}>
                  {references.map((r) => (
                    <li
                      key={`${r.source}-${r.id}`}
                      className={styles.listItem}
                      data-highlight="true"
                    >
                      <span
                        className={styles.pathBadge}
                        data-path={r.retrieval_path}
                      >
                        {r.retrieval_path === "rag" ? "RAG" : "Rule match"}
                      </span>
                      <span className={styles.refTitle}>{refLabel(r)}</span>
                      <span className={styles.matchHint}>{matchLabel(r)}</span>
                      {r.snippet && (
                        <p className={styles.refSnippet}>{r.snippet}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {decision && (
                <p className={styles.muted}>
                  Evidence frozen at decision · {context.length} context ·{" "}
                  {derivedFacts.length} facts ·{" "}
                  {decision.outcome.replaceAll("_", " ")}
                </p>
              )}
            </>
          )}
        </section>

        <section className={styles.section} aria-labelledby="do-heading">
          <h3 id="do-heading" className={styles.sectionTitle}>
            Recommended action
          </h3>
          {decision ? (
            <p className={styles.summary}>
              Decision: {decision.outcome.replaceAll("_", " ")}
              {decision.conditions ? ` — ${decision.conditions}` : ""}
            </p>
          ) : recommendations.length === 0 ? (
            <p className={styles.muted}>No recommendations yet.</p>
          ) : (
            <ul className={styles.list}>
              {recommendations.map((rec) => (
                <li key={rec.id} className={styles.recItem}>
                  <p className={styles.recText}>{rec.text}</p>
                  {rec.rationale && (
                    <p className={styles.recRationale}>{rec.rationale}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <details className={styles.traceDetails}>
          <summary className={styles.traceSummary}>Full reasoning trace</summary>
          <ReasoningTrace
            asset={asset}
            context={context}
            derivedFacts={derivedFacts}
            references={references}
            assessment={assessmentForTrace}
            decision={decision}
            areaOwner={areaOwner}
            compact
          />
        </details>
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
