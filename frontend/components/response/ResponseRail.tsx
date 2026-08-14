"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResponseAction } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import {
  canAbort,
  canRevoke,
  liveCount,
  phaseLabel,
  railPhase,
  secondsRemaining,
  sortForRail,
  tierLabel,
} from "@/lib/responseRail";
import { EnvelopeExplainer } from "./EnvelopeExplainer";
import styles from "./ResponseRail.module.css";

/**
 * Plant-wide view of what the system is doing on its own.
 *
 * Shows refused Tier 3 rows alongside live ones on purpose: an absent action
 * reads as one we never built, a refused one reads as a decision.
 */
export function ResponseRail() {
  // Narrow selectors — this rail ticks once a second while a countdown is live
  // and must not re-render the map with it.
  const actions = useLiveStore((s) => s.responseActions);
  const autoEnabled = useLiveStore((s) => s.responseAutoEnabled);
  const setResponseAuto = useLiveStore((s) => s.setResponseAuto);
  const abortResponse = useLiveStore((s) => s.abortResponse);
  const revokeResponse = useLiveStore((s) => s.revokeResponse);
  const ackResponsePage = useLiveStore((s) => s.ackResponsePage);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => sortForRail(actions), [actions]);
  const counting = rows.some((a) => a.status === "armed");

  // Only run a clock while something is actually counting down.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting]);

  if (rows.length === 0) return null;

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={styles.rail} aria-label="Automatic response">
      <header className={styles.header}>
        <span className={styles.mark}>Automatic response</span>
        <span className={styles.count}>{liveCount(rows)} in effect</span>
        <span className={styles.sim} title="No physical plant is connected">
          simulated
        </span>
        <button
          type="button"
          className={styles.pause}
          onClick={() => void setResponseAuto(!autoEnabled)}
          aria-pressed={!autoEnabled}
        >
          {autoEnabled ? "Pause all" : "Resume"}
        </button>
      </header>

      <ul className={styles.list}>
        {rows.map((a) => {
          const phase = railPhase(a);
          const secs = secondsRemaining(a, now);
          const expanded = expandedId === a.id;
          return (
            <li key={a.id} className={styles.row} data-phase={phase}>
              <span className={styles.tier} data-tier={a.tier}>
                {tierLabel(a.tier)}
              </span>

              <button
                type="button"
                className={styles.label}
                onClick={() => setExpandedId(expanded ? null : a.id)}
                aria-expanded={expanded}
              >
                <span className={styles.labelText}>{a.label}</span>
                {a.asset_name ? (
                  <span className={styles.asset}>{a.asset_name}</span>
                ) : null}
              </button>

              <span className={styles.phase} data-phase={phase}>
                {phaseLabel(a, now)}
                {phase === "arming" && secs !== null ? (
                  <span
                    className={styles.bar}
                    aria-hidden="true"
                    data-urgent={secs <= 3 ? "true" : undefined}
                  />
                ) : null}
              </span>

              <span className={styles.actions}>
                {canAbort(a) ? (
                  <button
                    type="button"
                    className={styles.btn}
                    disabled={busyId === a.id}
                    onClick={() => void run(a.id, () => abortResponse(a.id))}
                  >
                    Stop
                  </button>
                ) : null}
                {!canAbort(a) && canRevoke(a) ? (
                  <button
                    type="button"
                    className={styles.btn}
                    disabled={busyId === a.id}
                    onClick={() =>
                      void run(a.id, () =>
                        revokeResponse(a.id, "Revoked from response rail"),
                      )
                    }
                  >
                    Undo
                  </button>
                ) : null}
              </span>

              {expanded ? (
                <div className={styles.detail}>
                  <EnvelopeExplainer
                    envelope={a.envelope}
                    refusalReason={a.refusal_reason}
                  />
                  {a.pages.length > 0 ? (
                    <ul className={styles.pages}>
                      {a.pages.map((p) => (
                        <li key={p.id} className={styles.page}>
                          <span>
                            {p.role} · {p.channel}
                            {p.escalation_order > 1
                              ? ` · escalated (step ${p.escalation_order})`
                              : ""}
                          </span>
                          {p.acknowledged_at ? (
                            <span className={styles.acked}>
                              acknowledged by {p.acknowledged_by}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={styles.btn}
                              disabled={busyId === p.id}
                              onClick={() =>
                                void run(p.id, () => ackResponsePage(p.id))
                              }
                            >
                              Acknowledge
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
