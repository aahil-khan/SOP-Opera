"use client";

import { useEffect, useState } from "react";
import { fetchReviewResponseActions, type ResponseAction } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import { phaseLabel, railPhase, sortForRail, tierLabel } from "@/lib/responseRail";
import styles from "./ResponseBlock.module.css";

/**
 * "What the system already did" — shown above the decision controls.
 *
 * The supervisor's decision is the binding act, and they should make it knowing
 * the plant has already been put into a protective state on their behalf. Read
 * only: stopping or undoing an action happens on the rail, where the countdown
 * lives.
 */
export function ResponseBlock({ reviewId }: { reviewId: string }) {
  const [actions, setActions] = useState<ResponseAction[] | null>(null);
  // Refetch when anything in the response layer moves.
  const railActions = useLiveStore((s) => s.responseActions);

  useEffect(() => {
    let cancelled = false;
    fetchReviewResponseActions(reviewId)
      .then((rows) => {
        if (!cancelled) setActions(rows);
      })
      .catch(() => {
        if (!cancelled) setActions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, railActions]);

  if (!actions || actions.length === 0) return null;

  const rows = sortForRail(actions);
  const acted = rows.filter(
    (a) => a.status === "armed" || a.status === "active",
  );

  return (
    <section className={styles.block} aria-label="Automatic response taken">
      <header className={styles.header}>
        <span className={styles.title}>Automatic response</span>
        <span className={styles.sim}>simulated</span>
      </header>

      {acted.length === 0 ? (
        <p className={styles.none}>
          Nothing was actioned automatically for this review.
        </p>
      ) : null}

      <ul className={styles.list}>
        {rows.map((a) => {
          const phase = railPhase(a);
          return (
            <li key={a.id} className={styles.row} data-phase={phase}>
              <span className={styles.tier} data-tier={a.tier}>
                {tierLabel(a.tier)}
              </span>
              <span className={styles.label}>{a.label}</span>
              <span className={styles.phase}>{phaseLabel(a)}</span>
              {a.refusal_reason ? (
                <span className={styles.why}>{a.refusal_reason}</span>
              ) : null}
              {a.revoke_reason ? (
                <span className={styles.why}>
                  Undone by {a.revoked_by}: {a.revoke_reason}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
