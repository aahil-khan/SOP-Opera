"use client";

import { useEffect, useState } from "react";
import { fetchReviewResponseActions, type ResponseAction } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import {
  equipmentLabel,
  equipmentState,
  groupActions,
  plainState,
} from "@/lib/autoResponse";
import styles from "./ResponseBlock.module.css";

/**
 * "What the system already did", above the decision controls.
 *
 * The supervisor's decision is the binding act, and they should make it knowing
 * the plant has already been put into a protective state on their behalf. Read
 * only — stopping or undoing happens in the Auto response sidebar, where the
 * countdown lives.
 */
export function ResponseBlock({ reviewId }: { reviewId: string }) {
  const [actions, setActions] = useState<ResponseAction[] | null>(null);
  // Refetch whenever anything in the response layer moves.
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

  const { starting, inEffect, notAutomatic } = groupActions(actions);
  const acted = [...starting, ...inEffect];
  if (acted.length === 0 && notAutomatic.length === 0) return null;

  return (
    <section className={styles.block} aria-label="Automatic response taken">
      <header className={styles.header}>
        <span className={styles.title}>Automatic response</span>
      </header>

      {acted.length > 0 ? (
        <ul className={styles.list}>
          {acted.map((a) => {
            const state = equipmentState(a);
            return (
              <li key={a.id} className={styles.row} data-tier={a.tier}>
                <span className={styles.label}>{equipmentLabel(a)}</span>
                <span className={styles.state}>
                  {plainState(state) ??
                    (a.status === "armed" ? "starting" : "done")}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.none}>
          Nothing was actioned automatically for this review.
        </p>
      )}

      {notAutomatic.length > 0 ? (
        <p className={styles.declined}>
          {notAutomatic.length} action
          {notAutomatic.length === 1 ? "" : "s"} needed a person and were not
          taken automatically.
        </p>
      ) : null}
    </section>
  );
}
