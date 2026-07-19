"use client";

import { DOMAIN_META, type DomainId } from "@/lib/domains";
import type { ReasoningGraphNode } from "@/lib/reasoningGraph";
import styles from "./ReasoningGraphInspector.module.css";

interface ReasoningGraphInspectorProps {
  node: ReasoningGraphNode | null;
  /** Shown when nothing is selected */
  fallbackSummary?: string | null;
  fallbackRisk?: string | null;
}

function domainLabel(domain: DomainId | "core"): string {
  if (domain === "core") return "Core";
  return DOMAIN_META[domain].label;
}

export function ReasoningGraphInspector({
  node,
  fallbackSummary = null,
  fallbackRisk = null,
}: ReasoningGraphInspectorProps) {
  if (!node) {
    return (
      <aside className={styles.panel} aria-label="Node inspector">
        <h3 className={styles.title}>Inspector</h3>
        <p className={styles.hint}>
          Click a node in the graph to inspect it.
        </p>
        {fallbackSummary ? (
          <div className={styles.fallback}>
            {fallbackRisk && (
              <span className="badge" data-risk={fallbackRisk}>
                {fallbackRisk}
              </span>
            )}
            <p className={styles.detail}>{fallbackSummary}</p>
          </div>
        ) : (
          <p className={styles.muted}>No assessment summary yet.</p>
        )}
      </aside>
    );
  }

  const colorVar =
    node.domain === "core"
      ? "--accent-ai"
      : DOMAIN_META[node.domain].colorVar;

  return (
    <aside className={styles.panel} aria-label="Node inspector">
      <header className={styles.header}>
        <span
          className={styles.dot}
          style={{ background: `var(${colorVar})` }}
        />
        <div className={styles.headerText}>
          <p className={styles.kind}>
            {node.kind.replaceAll("_", " ")} · {domainLabel(node.domain)}
          </p>
          <h3 className={styles.title}>{node.label}</h3>
        </div>
      </header>
      <p className={styles.detail}>{node.detail}</p>
      {node.meta && Object.keys(node.meta).length > 0 && (
        <dl className={styles.meta}>
          {Object.entries(node.meta).map(([k, v]) =>
            v ? (
              <div key={k} className={styles.metaRow}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ) : null,
          )}
        </dl>
      )}
    </aside>
  );
}
