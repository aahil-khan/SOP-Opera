"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Decision } from "@/shared/schemas";
import type { Report } from "@/shared/schemas";
import type { DecisionOutcome } from "@/shared/enums";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import { fetchReviewReports } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import type { AreaOwner } from "@/shared/schemas";
import { fetchRoster } from "@/lib/authApi";
import type { RosterEntry } from "@/lib/authTypes";
import styles from "./DecisionPanel.module.css";

interface DecisionPanelProps {
  reviewId: string;
  reviewState: string;
  assessment: AssessmentHistoryItem | null;
  existing: Decision | null;
  areaOwner?: AreaOwner | null;
}

const OUTCOMES: {
  value: DecisionOutcome;
  title: string;
  description: string;
  icon: string;
}[] = [
  {
    value: "approved",
    title: "Approved",
    description: "Proceed as recommended — all actions accepted.",
    icon: "✓",
  },
  {
    value: "approved_with_conditions",
    title: "Approved with conditions",
    description: "Proceed, but with added requirements before execution.",
    icon: "◑",
  },
  {
    value: "blocked",
    title: "Blocked",
    description: "Halt — do not proceed until the situation is resolved.",
    icon: "✕",
  },
];

function DecisionForm({
  reviewId,
  assessment,
  zoneOwnerId,
}: {
  reviewId: string;
  assessment: AssessmentHistoryItem;
  zoneOwnerId: string | null;
}) {
  const submitDecision = useLiveStore((s) => s.submitDecision);
  const blockingAssessment = assessment.risk_level === "blocking";
  const allowedOutcomes = blockingAssessment
    ? OUTCOMES.filter((o) => o.value === "blocked")
    : OUTCOMES;
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [workers, setWorkers] = useState<RosterEntry[]>([]);
  const [taggedWorkerIds, setTaggedWorkerIds] = useState<Set<string>>(
    () => new Set(zoneOwnerId ? [zoneOwnerId] : []),
  );

  useEffect(() => {
    setTaggedWorkerIds(new Set(zoneOwnerId ? [zoneOwnerId] : []));
  }, [zoneOwnerId]);

  useEffect(() => {
    let cancelled = false;
    void fetchRoster()
      .then((roster) => {
        if (cancelled) return;
        const workerEntries = roster.filter((r) => r.kind === "worker");
        setWorkers(workerEntries);
        // If we haven't set a locked zone owner yet, fall back to whatever exists.
        if (zoneOwnerId) {
          setTaggedWorkerIds((prev) => {
            const next = new Set(prev);
            next.add(zoneOwnerId);
            return next;
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initialDispositions: Record<string, "accepted" | "rejected"> =
    Object.fromEntries(
      assessment.recommendations.map((rec) => [rec.id, "accepted" as const]),
    );
  const [dispositions, setDispositions] = useState(initialDispositions);

  const needsConditions = outcome === "approved_with_conditions";
  const canSubmit =
    outcome !== null && (!needsConditions || conditions.trim().length > 0);

  useEffect(() => {
    if (!blockingAssessment) return;
    setOutcome("blocked");
  }, [blockingAssessment]);

  async function onSubmit() {
    if (!outcome) return;
    if (blockingAssessment && outcome !== "blocked") return;
    setBusy(true);
    setError(null);
    try {
      await submitDecision(reviewId, {
        outcome,
        recommendation_dispositions: dispositions,
        conditions: needsConditions ? conditions.trim() : null,
        tagged_worker_ids: Array.from(taggedWorkerIds),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.panel}>
      {assessment.recommendations.length > 0 && (
        <section className={styles.section} aria-labelledby="decision-recs-heading">
          <p id="decision-recs-heading" className={styles.label}>
            Review recommendations
          </p>
          <p className={styles.sectionHint}>
            Accept or reject each action before making your call.
          </p>
          <div className={styles.recList}>
            {assessment.recommendations.map((rec, index) => {
              const disposition = dispositions[rec.id];
              return (
                <article
                  key={rec.id}
                  className={styles.recCard}
                  data-rejected={disposition === "rejected"}
                >
                  <div className={styles.recCardHeader}>
                    <span className={styles.recIndex} aria-hidden>
                      {index + 1}
                    </span>
                    <div className={styles.recBody}>
                      <p className={styles.recText}>{rec.text}</p>
                      {rec.rationale ? (
                        <p className={styles.recRationale}>{rec.rationale}</p>
                      ) : null}
                    </div>
                    <div
                      className={styles.recToggle}
                      role="group"
                      aria-label={`Disposition for recommendation ${index + 1}`}
                    >
                      {(["accepted", "rejected"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className={styles.recToggleBtn}
                          data-active={disposition === kind}
                          data-kind={kind}
                          aria-pressed={disposition === kind}
                          onClick={() =>
                            setDispositions((d) => ({ ...d, [rec.id]: kind }))
                          }
                        >
                          <span className={styles.recToggleIcon} aria-hidden>
                            {kind === "accepted" ? "✓" : "✕"}
                          </span>
                          {kind === "accepted" ? "Accept" : "Reject"}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {workers.length > 0 ? (
        <section className={styles.section} aria-labelledby="decision-tag-heading">
          <p id="decision-tag-heading" className={styles.label}>
            Notify people
          </p>
          <p className={styles.sectionHint}>
            The zone supervisor is always included.
          </p>
          <div className={styles.tagList} role="list" aria-label="Notification recipients">
            {workers.map((w) => {
              const locked = zoneOwnerId ? w.id === zoneOwnerId : false;
              const checked = taggedWorkerIds.has(w.id);
              return (
                <label
                  key={w.id}
                  className={styles.tagRow}
                  data-locked={locked ? "true" : undefined}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={(e) => {
                      const next = new Set(taggedWorkerIds);
                      if (e.target.checked) next.add(w.id);
                      else next.delete(w.id);
                      setTaggedWorkerIds(next);
                    }}
                  />
                  <span className={styles.tagName}>
                    {w.name}{" "}
                    <span className={styles.tagRole}>
                      ({w.role})
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="decision-outcome-heading">
        <p id="decision-outcome-heading" className={styles.label}>
          Make the call
        </p>
        <p className={styles.sectionHint}>
          Choose the final outcome for this review.
        </p>
        {blockingAssessment ? (
          <p className={styles.error}>
            Blocking assessment: decision is restricted to blocked.
          </p>
        ) : null}
        <div className={styles.outcomeList} role="radiogroup" aria-label="Decision outcome">
          {allowedOutcomes.map((o) => {
            const selected = outcome === o.value;
            const isConditions = o.value === "approved_with_conditions";
            return (
              <div
                key={o.value}
                className={styles.outcomeCard}
                data-outcome={o.value}
                data-active={selected}
                role="radio"
                aria-checked={selected}
              >
                <button
                  type="button"
                  className={styles.outcomeCardSelect}
                  onClick={() => setOutcome(o.value)}
                >
                  <div className={styles.outcomeCardInner}>
                    <span className={styles.outcomeAccent} aria-hidden />
                    <span className={styles.outcomeIcon} aria-hidden>
                      {o.icon}
                    </span>
                    <div className={styles.outcomeContent}>
                      <p className={styles.outcomeTitle}>{o.title}</p>
                      <p className={styles.outcomeDesc}>{o.description}</p>
                    </div>
                  </div>
                </button>
                {isConditions ? (
                  <div
                    className={styles.outcomeConditionsWrap}
                    data-expanded={selected}
                  >
                    <div className={styles.outcomeConditionsInner}>
                      <label
                        className={styles.conditionsLabel}
                        htmlFor="decision-conditions"
                      >
                        Conditions required before proceeding
                      </label>
                      <textarea
                        id="decision-conditions"
                        className={styles.textarea}
                        value={conditions}
                        onChange={(e) => setConditions(e.target.value)}
                        rows={2}
                        placeholder="e.g. Re-inspect isolation valve, confirm gas levels below threshold…"
                        tabIndex={selected ? 0 : -1}
                        aria-hidden={!selected}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        className={`btn btn-primary ${styles.submit}`}
        disabled={!canSubmit || busy}
        onClick={() => void onSubmit()}
      >
        {busy ? "Submitting…" : "Submit decision"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

function ClosedReportLink({
  reviewId,
  outcome,
}: {
  reviewId: string;
  outcome: DecisionOutcome | null | undefined;
}) {
  const reopenReview = useLiveStore((s) => s.reopenReview);
  const [report, setReport] = useState<Report | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchReviewReports(reviewId)
      .then((reports) => {
        if (!cancelled && reports.length) setReport(reports[0]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  return (
    <div className={styles.panel}>
      <p className={styles.done}>
        {outcome === "blocked" ? "Incident closed · work halted" : "All clear"}
      </p>
      {report ? (
        <p className={styles.hint}>
          Closure report ready —{" "}
          <Link href={`/reports/${report.id}`} className={styles.reportLink}>
            {(report.content?.title as string) ??
              `Report #${report.closure_event_seq}`}
          </Link>
        </p>
      ) : (
        <p className={styles.hint}>Generating report…</p>
      )}
      <div className={styles.actionRow}>
        <button
          type="button"
          className={`btn ${styles.secondaryAction}`}
          disabled={reopening}
          onClick={() => {
            setReopening(true);
            setReopenError(null);
            void reopenReview(reviewId, "Operator reopen")
              .catch((err) =>
                setReopenError(err instanceof Error ? err.message : String(err)),
              )
              .finally(() => setReopening(false));
          }}
        >
          {reopening ? "Reopening…" : "Reopen review"}
        </button>
      </div>
      {reopenError && <p className={styles.error}>{reopenError}</p>}
    </div>
  );
}

export function DecisionPanel({
  reviewId,
  reviewState,
  assessment,
  existing,
  areaOwner,
}: DecisionPanelProps) {
  const closeReview = useLiveStore((s) => s.closeReview);
  const reopenReview = useLiveStore((s) => s.reopenReview);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [reopenError, setReopenError] = useState<string | null>(null);

  const canDecide =
    (reviewState === "pending_decision" || reviewState === "escalated") &&
    assessment?.status === "complete";

  const priorDecisionSuperseded =
    Boolean(existing) &&
    Boolean(assessment) &&
    existing!.assessment_id !== assessment!.id;

  if (reviewState === "closed") {
    return (
      <ClosedReportLink reviewId={reviewId} outcome={existing?.outcome} />
    );
  }

  if (existing && reviewState === "decided") {
    const recommendationItems =
      assessment?.recommendations.map((rec) => {
        const disposition = existing.recommendation_dispositions[rec.id];
        return {
          id: rec.id,
          text: rec.text,
          disposition: disposition ?? "accepted",
        };
      }) ?? [];
    return (
      <div className={styles.panel}>
        <p className={styles.done}>
          Submitted · <strong>{existing.outcome.replaceAll("_", " ")}</strong>
          {existing.conditions ? ` — ${existing.conditions}` : ""}
        </p>
        <p className={styles.hint}>
          Evidence frozen at {new Date(existing.submitted_at).toLocaleString()}.
        </p>
        {recommendationItems.length > 0 ? (
          <section className={styles.section} aria-labelledby="execution-heading">
            <p id="execution-heading" className={styles.label}>
              Execution snapshot
            </p>
            <div className={styles.recList}>
              {recommendationItems.map((item, idx) => (
                <article
                  key={item.id}
                  className={styles.recCard}
                  data-rejected={item.disposition === "rejected"}
                >
                  <div className={styles.recCardHeader}>
                    <span className={styles.recIndex} aria-hidden>
                      {idx + 1}
                    </span>
                    <div className={styles.recBody}>
                      <p className={styles.recText}>{item.text}</p>
                      <p className={styles.recRationale}>
                        {item.disposition === "accepted"
                          ? "Accepted for execution"
                          : "Rejected by decision"}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {existing.outcome === "blocked" ? (
          <p className={styles.hint}>
            Machine is inactive in simulator until the lock window ends and the review is closed.
          </p>
        ) : null}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={`btn btn-primary ${styles.submit}`}
            disabled={closing || reopening}
            onClick={() => {
              setClosing(true);
              setCloseError(null);
              void closeReview(reviewId)
                .catch((err) =>
                  setCloseError(err instanceof Error ? err.message : String(err)),
                )
                .finally(() => setClosing(false));
            }}
          >
            {closing ? "Closing…" : "Close Review"}
          </button>
          <button
            type="button"
            className={`btn ${styles.secondaryAction}`}
            disabled={closing || reopening}
            onClick={() => {
              setReopening(true);
              setReopenError(null);
              void reopenReview(reviewId, "Operator reopen")
                .catch((err) =>
                  setReopenError(
                    err instanceof Error ? err.message : String(err),
                  ),
                )
                .finally(() => setReopening(false));
            }}
          >
            {reopening ? "Reopening…" : "Reopen"}
          </button>
        </div>
        {closeError && <p className={styles.error}>{closeError}</p>}
        {reopenError && <p className={styles.error}>{reopenError}</p>}
      </div>
    );
  }

  if (existing && !canDecide && reviewState !== "decided") {
    return (
      <div className={styles.panel}>
        <p className={styles.done}>
          Submitted · <strong>{existing.outcome.replaceAll("_", " ")}</strong>
          {existing.conditions ? ` — ${existing.conditions}` : ""}
        </p>
        <p className={styles.hint}>
          Evidence frozen at {new Date(existing.submitted_at).toLocaleString()}.
        </p>
      </div>
    );
  }

  if (!canDecide) {
    return (
      <div className={styles.panel}>
        <p className={styles.hint}>
          A complete Assessment is required before a Decision can be submitted.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {priorDecisionSuperseded && existing ? (
        <p className={styles.superseded}>
          Prior decision ({existing.outcome.replaceAll("_", " ")}) superseded
          — situation escalated since{" "}
          {new Date(existing.submitted_at).toLocaleTimeString()}.
        </p>
      ) : null}
      <EscalationControls reviewId={reviewId} reviewState={reviewState} />
      <DecisionForm
        key={assessment.id}
        reviewId={reviewId}
        assessment={assessment}
        zoneOwnerId={areaOwner?.worker_id ?? null}
      />
    </div>
  );
}

function EscalationControls({
  reviewId,
  reviewState,
}: {
  reviewId: string;
  reviewState: string;
}) {
  const escalateReview = useLiveStore((s) => s.escalateReview);
  const deEscalateReview = useLiveStore((s) => s.deEscalateReview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (reviewState !== "pending_decision" && reviewState !== "escalated") {
    return null;
  }

  const isEscalated = reviewState === "escalated";

  async function onToggle() {
    setBusy(true);
    setError(null);
    try {
      if (isEscalated) {
        await deEscalateReview(reviewId, reason.trim());
      } else {
        await escalateReview(reviewId, reason.trim() || "Operator escalation");
      }
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="escalation-heading">
      <p id="escalation-heading" className={styles.label}>
        Escalation
      </p>
      {isEscalated ? (
        <p className={styles.escalatedBanner} role="status">
          This review is escalated — decide now or resolve the escalation.
        </p>
      ) : (
        <p className={styles.sectionHint}>
          Escalate when this needs senior attention before a decision.
        </p>
      )}
      <label className={styles.conditionsLabel} htmlFor="escalation-reason">
        Reason (optional)
      </label>
      <input
        id="escalation-reason"
        className={styles.escalationInput}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          isEscalated ? "Why resolving escalation…" : "Why escalating…"
        }
        disabled={busy}
      />
      <div className={styles.actionRow}>
        <button
          type="button"
          className={`btn ${styles.secondaryAction}`}
          disabled={busy}
          onClick={() => void onToggle()}
        >
          {busy
            ? isEscalated
              ? "Resolving…"
              : "Escalating…"
            : isEscalated
              ? "Resolve escalation"
              : "Escalate"}
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
