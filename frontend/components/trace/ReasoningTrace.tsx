"use client";

import type {
  AreaOwner,
  Assessment,
  Asset,
  Context,
  Decision,
  DerivedFact,
  ReasoningFactor,
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
  areaOwner?: AreaOwner | null;
  compact?: boolean;
}

function ctxSummary(c: Context): string {
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
  if (c.category === "certification") {
    const name =
      typeof p.worker_name === "string"
        ? p.worker_name
        : String(p.worker_id ?? "worker");
    return `Certification · ${name}`;
  }
  return `${c.category}`;
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

function groupRefs(refs: RetrievedReference[]) {
  const groups: Record<string, RetrievedReference[]> = {
    regulations: [],
    sops: [],
    historical_incidents: [],
  };
  for (const r of refs) {
    (groups[r.source] ??= []).push(r);
  }
  return groups;
}

function EvidenceList({ references }: { references: RetrievedReference[] }) {
  if (references.length === 0) {
    return <span className={styles.empty}>None retrieved</span>;
  }
  const groups = groupRefs(references);
  const labels: Record<string, string> = {
    regulations: "Regulations",
    sops: "SOPs",
    historical_incidents: "Historical incidents",
  };
  return (
    <div className={styles.evidenceGroups}>
      {Object.entries(groups).map(([source, items]) =>
        items.length === 0 ? null : (
          <div key={source} className={styles.evidenceGroup}>
            <p className={styles.groupLabel}>{labels[source] ?? source}</p>
            <ul className={styles.refList}>
              {items.map((r) => (
                <li key={`${r.source}-${r.id}`} className={styles.refCard}>
                  <div className={styles.refHeader}>
                    <span
                      className={styles.pathBadge}
                      data-path={r.retrieval_path}
                    >
                      {r.retrieval_path === "rag" ? "RAG" : "Rule match"}
                    </span>
                    <span className={styles.score}>{matchLabel(r)}</span>
                  </div>
                  <p className={styles.refTitle}>{refLabel(r)}</p>
                  {r.snippet && (
                    <p className={styles.refSnippet}>{r.snippet}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}

function FactorList({ factors }: { factors: ReasoningFactor[] }) {
  if (factors.length === 0) return null;
  return (
    <ul className={styles.factorList}>
      {factors.map((f) => (
        <li key={f.fact_type} className={styles.factorItem}>
          <strong className={styles.factorHeadline}>{f.headline}</strong>
          <p className={styles.factorDetail}>{f.detail}</p>
          {f.evidence.length > 0 && (
            <ul className={styles.factorEvidence}>
              {f.evidence.map((e) => (
                <li key={`${e.source}-${e.id}`}>
                  {refLabel(e)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function onSiteWorkers(context: Context[]): string[] {
  const names: string[] = [];
  for (const c of context) {
    if (c.category !== "worker_location") continue;
    const p = c.payload;
    const name =
      typeof p.worker_name === "string"
        ? p.worker_name
        : typeof p.worker_id === "string"
          ? p.worker_id.slice(0, 8)
          : null;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function ReasoningTrace({
  asset,
  context,
  derivedFacts,
  references,
  assessment,
  decision,
  areaOwner = null,
  compact = false,
}: ReasoningTraceProps) {
  const factors =
    assessment?.reasoning_factors ??
    assessment?.metadata?.reasoning_factors ??
    [];
  const workers = onSiteWorkers(context);

  return (
    <div className={`${styles.trace} ${compact ? styles.compact : ""}`}>
      <details className={styles.section} open>
        <summary className={styles.sectionSummary}>Trigger &amp; facts</summary>
        <div className={styles.sectionBody}>
          <TraceNode label="Asset" filled>
            <strong>{asset.name}</strong>
            <div className={`${styles.empty} ${styles.zoneMeta}`}>
              zone · {asset.zone}
            </div>
          </TraceNode>
          <TraceNode label="Live context" filled={context.length > 0}>
            {context.length === 0 ? (
              <span className={styles.empty}>No live context yet</span>
            ) : (
              <ul className={styles.factList}>
                {context.map((c) => (
                  <li key={c.id} className={styles.factItem}>
                    {ctxSummary(c)}
                  </li>
                ))}
              </ul>
            )}
          </TraceNode>
          <TraceNode label="Derived facts" filled={derivedFacts.length > 0}>
            {derivedFacts.length === 0 ? (
              <span className={styles.empty}>None computed</span>
            ) : (
              <div className={styles.factChips}>
                {derivedFacts.map((f) => (
                  <TraceChip key={f.id} strong>
                    {String(f.fact_type).replaceAll("_", " ")}
                  </TraceChip>
                ))}
              </div>
            )}
          </TraceNode>
        </div>
      </details>

      <details className={styles.section} open>
        <summary className={styles.sectionSummary}>Area &amp; people</summary>
        <div className={styles.sectionBody}>
          <TraceNode label="Area owner" filled={areaOwner != null}>
            {!areaOwner ? (
              <span className={styles.empty}>No area owner assigned</span>
            ) : (
              <>
                <strong>{areaOwner.name}</strong>
                <div className={`${styles.empty} ${styles.zoneMeta}`}>
                  {areaOwner.role} · {areaOwner.zone}
                </div>
              </>
            )}
          </TraceNode>
          <TraceNode label="On site" filled={workers.length > 0}>
            {workers.length === 0 ? (
              <span className={styles.empty}>No workers detected in zone</span>
            ) : (
              <div className={styles.factChips}>
                {workers.map((w) => (
                  <TraceChip key={w} strong>
                    {w}
                  </TraceChip>
                ))}
              </div>
            )}
          </TraceNode>
        </div>
      </details>

      <details className={styles.section} open>
        <summary className={styles.sectionSummary}>Evidence</summary>
        <div className={styles.sectionBody}>
          <TraceNode label="Retrieved knowledge" filled={references.length > 0}>
            <EvidenceList references={references} />
          </TraceNode>
        </div>
      </details>

      <details className={styles.section} open>
        <summary className={styles.sectionSummary}>AI assessment</summary>
        <div className={styles.sectionBody}>
          <TraceNode label="Summary" filled={assessment != null}>
            {!assessment ? (
              <span className={styles.empty}>Awaiting assessment…</span>
            ) : (
              <>
                <span className="badge" data-risk={assessment.risk_level}>
                  {assessment.risk_level}
                </span>
                <p
                  className={`${styles.assessmentBody} ${compact ? styles.bodyClamp : ""}`}
                >
                  {assessment.summary}
                </p>
                {assessment.metadata && !compact && (
                  <p className={styles.metaLine}>
                    {assessment.metadata.provider} · retrieval{" "}
                    {assessment.metadata.retrieval_mode} (
                    {assessment.metadata.retrieval_quality}) · confidence{" "}
                    {(assessment.metadata.confidence * 100).toFixed(0)}%
                  </p>
                )}
              </>
            )}
          </TraceNode>
          {factors.length > 0 && (
            <TraceNode label="Why (factors)" filled>
              <FactorList factors={factors} />
            </TraceNode>
          )}
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
        </div>
      </details>

      <details className={styles.section} open={!compact}>
        <summary className={styles.sectionSummary}>Decision</summary>
        <div className={styles.sectionBody}>
          <TraceNode label="Outcome" filled={decision != null}>
            {!decision ? (
              <span className={styles.empty}>Pending supervisor decision</span>
            ) : (
              <>
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
                {decision.conditions && (
                  <p className={styles.conditions}>
                    Conditions: {decision.conditions}
                  </p>
                )}
              </>
            )}
          </TraceNode>
        </div>
      </details>
    </div>
  );
}
