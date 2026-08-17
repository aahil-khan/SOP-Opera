"use client";

import type { ResponseAction, ResponseEnvelope } from "@/lib/liveApi";
import {
  CLAUSES_FOR_ALLOWED,
  CLAUSES_FOR_REFUSED,
  equipmentBlurb,
} from "@/lib/autoResponse";
import styles from "./EnvelopeExplainer.module.css";

/**
 * What this action is, and why the system was — or was not — allowed to do it.
 *
 * Order matters. It opens with a plain sentence saying what the equipment
 * physically is, because the panel names things ("Muster alarm", "Tool gate")
 * that mean nothing to anyone who has not worked a plant. The safety argument
 * only lands once you know what was switched on.
 *
 * The clause list is deliberately shorter for an action that ran: "tier allows
 * automation" is circular once something has happened, and reads as filler next
 * to three claims that say something. On a refusal it is the entire reason, so
 * it stays.
 */
export function EnvelopeExplainer({
  action,
  envelope,
  refusalReason,
}: {
  action: ResponseAction;
  envelope: ResponseEnvelope;
  refusalReason?: string | null;
}) {
  const clauses = envelope.clauses ?? {};
  const allowed = envelope.allowed;
  const shown = allowed ? CLAUSES_FOR_ALLOWED : CLAUSES_FOR_REFUSED;
  // The gate evaluates in order and stops at the first failure, so the first
  // false clause is the one that decided a refusal.
  const decidingKey = CLAUSES_FOR_REFUSED.find(
    ({ key }) => clauses[key] === false,
  )?.key;
  const blurb = equipmentBlurb(action);

  return (
    <div className={styles.card} role="note">
      {blurb ? <p className={styles.blurb}>{blurb}</p> : null}

      <p className={styles.heading}>
        {allowed ? "Safe to do automatically" : "Not done automatically"}
      </p>

      <ul className={styles.clauses}>
        {shown.map(({ key, label }) => {
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
          <span className={styles.reasonLabel}>Undo</span> {envelope.reversal}
        </p>
      ) : null}
    </div>
  );
}
