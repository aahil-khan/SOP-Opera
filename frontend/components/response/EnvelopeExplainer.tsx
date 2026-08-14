"use client";

import type { ResponseEnvelope } from "@/lib/liveApi";
import { CLAUSE_LABELS } from "@/lib/autoResponse";
import styles from "./EnvelopeExplainer.module.css";

/**
 * Why this action was allowed to happen by itself — or why it was not.
 *
 * Shows all four clauses of the reversibility envelope with the one that
 * decided the outcome marked. The point is that a judge (or a safety officer)
 * can see the boundary of the automation in about ten seconds, rather than
 * being asked to trust it.
 */
export function EnvelopeExplainer({
  envelope,
  refusalReason,
}: {
  envelope: ResponseEnvelope;
  refusalReason?: string | null;
}) {
  const clauses = envelope.clauses ?? {};
  // The gate evaluates in order and stops at the first failure, so the first
  // false clause is the one that decided a refusal.
  const decidingKey = CLAUSE_LABELS.find(
    ({ key }) => clauses[key] === false,
  )?.key;

  return (
    <div className={styles.card} role="note">
      <p className={styles.heading}>
        {envelope.allowed
          ? "Allowed to act automatically because:"
          : "Not allowed to act automatically:"}
      </p>
      <ul className={styles.clauses}>
        {CLAUSE_LABELS.map(({ key, label }) => {
          const held = clauses[key];
          return (
            <li
              key={key}
              className={styles.clause}
              data-held={held === false ? "false" : "true"}
              data-deciding={key === decidingKey ? "true" : undefined}
            >
              <span aria-hidden="true" className={styles.tick}>
                {held === false ? "✕" : "✓"}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ul>

      {refusalReason ? (
        <p className={styles.reason}>{refusalReason}</p>
      ) : envelope.reversal ? (
        <p className={styles.reason}>
          <span className={styles.reasonLabel}>Undone by</span>{" "}
          {envelope.reversal}
        </p>
      ) : null}

      <p className={styles.meta}>
        Affects: {envelope.blast_radius === "none" ? "no plant equipment" : envelope.blast_radius}
      </p>
    </div>
  );
}
