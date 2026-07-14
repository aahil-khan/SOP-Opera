"use client";

import Link from "next/link";
import type { AssetRuntime } from "@/lib/mockData";
import { ReasoningTrace } from "@/components/trace/ReasoningTrace";
import styles from "./AssetPanel.module.css";

interface AssetPanelProps {
  runtime: AssetRuntime;
  onClose: () => void;
}

export function AssetPanel({ runtime, onClose }: AssetPanelProps) {
  const { asset, risk_level, review, incidents } = runtime;

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
            context={runtime.context}
            derivedFacts={runtime.derived_facts}
            references={runtime.references}
            assessment={runtime.assessment}
            decision={runtime.decision}
            compact
          />
        </section>

        {incidents.length > 0 && (
          <section>
            <h3 className={styles.sectionTitle}>Incident history</h3>
            <ul className={styles.incidentList}>
              {incidents.map((inc) => (
                <li key={inc.id}>
                  {inc.title}
                  <br />
                  <small>{new Date(inc.occurred_at).toLocaleDateString()}</small>
                </li>
              ))}
            </ul>
          </section>
        )}

        {runtime.decision && (
          <section>
            <h3 className={styles.sectionTitle}>Evidence (frozen)</h3>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
              Context and assessment cited at decision time are frozen as Evidence.
              {runtime.context.length} context · {runtime.derived_facts.length}{" "}
              facts · decision {runtime.decision.outcome.replaceAll("_", " ")}.
            </p>
          </section>
        )}
      </div>

      {review && (
        <div className={styles.footer}>
          <Link className="btn btn-primary" href={`/reviews/${review.id}`} style={{ width: "100%" }}>
            View full review
          </Link>
        </div>
      )}
    </aside>
  );
}
