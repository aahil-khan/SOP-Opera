"use client";

import type {
  Assessment,
  Asset,
  Context,
  Decision,
  DerivedFact,
  RetrievedReference,
} from "@/shared/schemas";
import { TraceChip, TraceNode } from "./TraceNode";
import styles from "./ReasoningTrace.module.css";

interface ReasoningTraceProps {
  asset: Asset;
  context: Context[];
  derivedFacts: DerivedFact[];
  references: RetrievedReference[];
  assessment: Assessment | null;
  decision: Decision | null;
  compact?: boolean;
}

function ctxSummary(c: Context): string {
  const p = c.payload;
  if (c.category === "sensor" && typeof p.gas_reading === "number") {
    return `Gas ${p.gas_reading}${typeof p.unit === "string" ? ` ${p.unit}` : ""}`;
  }
  if (c.category === "worker_location") {
    return `Worker ${String(p.worker_id ?? "?")} in ${String(p.zone ?? "?")}`;
  }
  if (c.category === "permit") {
    return `Permit ${String(p.permit_id ?? "?")} · ${String(p.status ?? "")}`;
  }
  return `${c.category}`;
}

export function ReasoningTrace({
  asset,
  context,
  derivedFacts,
  references,
  assessment,
  decision,
  compact = false,
}: ReasoningTraceProps) {
  return (
    <div className={`${styles.trace} ${compact ? styles.compact : ""}`}>
      <TraceNode label="Asset">
        <strong>{asset.name}</strong>
        <div className={styles.empty} style={{ fontStyle: "normal", marginTop: 2 }}>
          zone · {asset.zone}
        </div>
      </TraceNode>

      <TraceNode label="Context" filled={context.length > 0}>
        {context.length === 0 ? (
          <span className={styles.empty}>No live context yet</span>
        ) : (
          <ul className={styles.factList}>
            {context.map((c) => (
              <li key={c.id} className={styles.factItem}>
                {ctxSummary(c)}
                {!compact && (
                  <span className={styles.empty} style={{ marginLeft: 6 }}>
                    · {c.provider}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </TraceNode>

      <TraceNode label="Derived Facts" filled={derivedFacts.length > 0}>
        {derivedFacts.length === 0 ? (
          <span className={styles.empty}>None computed</span>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {derivedFacts.map((f) => (
              <TraceChip key={f.id} strong>
                {String(f.fact_type).replaceAll("_", " ")}
              </TraceChip>
            ))}
          </div>
        )}
      </TraceNode>

      <TraceNode label="Retrieved References" filled={references.length > 0}>
        {references.length === 0 ? (
          <span className={styles.empty}>None retrieved</span>
        ) : (
          <ul className={styles.refList}>
            {references.map((r) => (
              <li key={`${r.source}-${r.id}`} className={styles.refItem}>
                <span
                  className={styles.pathBadge}
                  data-path={r.retrieval_path}
                >
                  {r.retrieval_path}
                </span>
                {r.source.replaceAll("_", " ")}
                {r.score != null ? (
                  <span style={{ color: "var(--muted)" }}>
                    {" "}
                    · score {r.score.toFixed(2)}
                  </span>
                ) : (
                  <span style={{ color: "var(--muted)" }}> · score —</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </TraceNode>

      <TraceNode label="Assessment" filled={assessment != null}>
        {!assessment ? (
          <span className={styles.empty}>Awaiting assessment…</span>
        ) : (
          <>
            <span className="badge" data-risk={assessment.risk_level}>
              {assessment.risk_level}
            </span>
            <p
              className={compact ? styles.bodyClamp : undefined}
              style={{ margin: "0.4rem 0 0" }}
            >
              {assessment.summary}
            </p>
            {assessment.metadata && !compact && (
              <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.8rem" }}>
                {assessment.metadata.provider} · retrieval{" "}
                {assessment.metadata.retrieval_mode} (
                {assessment.metadata.retrieval_quality}) · confidence{" "}
                {(assessment.metadata.confidence * 100).toFixed(0)}%
              </p>
            )}
          </>
        )}
      </TraceNode>

      <TraceNode
        label="Recommendations"
        filled={(assessment?.recommendations.length ?? 0) > 0}
      >
        {!assessment?.recommendations.length ? (
          <span className={styles.empty}>None yet</span>
        ) : (
          <ul className={styles.recList}>
            {assessment.recommendations.map((rec) => (
              <li key={rec.id} className={styles.recItem}>
                {rec.text}
                {rec.disposition && rec.disposition !== "proposed" && (
                  <TraceChip>{rec.disposition}</TraceChip>
                )}
              </li>
            ))}
          </ul>
        )}
      </TraceNode>

      <TraceNode label="Decision" filled={decision != null}>
        {!decision ? (
          <span className={styles.empty}>Pending supervisor decision</span>
        ) : (
          <>
            <span className="badge" data-risk={
              decision.outcome === "blocked" ? "blocking" :
              decision.outcome === "approved_with_conditions" ? "elevated" : "nominal"
            }>
              {decision.outcome.replaceAll("_", " ")}
            </span>
            {decision.conditions && (
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
                Conditions: {decision.conditions}
              </p>
            )}
          </>
        )}
      </TraceNode>
    </div>
  );
}
