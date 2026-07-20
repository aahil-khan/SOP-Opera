"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Decision } from "@/shared/schemas";
import type { Report } from "@/shared/schemas";
import type { DecisionOutcome } from "@/shared/enums";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import { fetchReviewReports } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import styles from "./DecisionPanel.module.css";

interface DecisionPanelProps {
  reviewId: string;
  reviewState: string;
  assessment: AssessmentHistoryItem | null;
  existing: Decision | null;
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
}: {
  reviewId: string;
  assessment: AssessmentHistoryItem;
}) {
  const submitDecision = useLiveStore((s) => s.submitDecision);
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null);
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialDispositions: Record<string, "accepted" | "rejected"> =
    Object.fromEntries(
      assessment.recommendations.map((rec) => [rec.id, "accepted" as const]),
    );
  const [dispositions, setDispositions] = useState(initialDispositions);

  const needsConditions = outcome === "approved_with_conditions";
  const canSubmit =
    outcome !== null && (!needsConditions || conditions.trim().length > 0);

  async function onSubmit() {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    try {
      await submitDecision(reviewId, {
        outcome,
        recommendation_dispositions: dispositions,
        conditions: needsConditions ? conditions.trim() : null,
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

      <section className={styles.section} aria-labelledby="decision-outcome-heading">
        <p id="decision-outcome-heading" className={styles.label}>
          Make the call
        </p>
        <p className={styles.sectionHint}>
          Choose the final outcome for this review.
        </p>
        <div className={styles.outcomeList} role="radiogroup" aria-label="Decision outcome">
          {OUTCOMES.map((o) => {
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

function ClosedReportLink({ reviewId }: { reviewId: string }) {
  const [report, setReport] = useState<Report | null>(null);

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
      <p className={styles.done}>Review closed</p>
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
    </div>
  );
}

export function DecisionPanel({
  reviewId,
  reviewState,
  assessment,
  existing,
}: DecisionPanelProps) {
  const closeReview = useLiveStore((s) => s.closeReview);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const canDecide =
    (reviewState === "pending_decision" || reviewState === "escalated") &&
    assessment?.status === "complete";

  const priorDecisionSuperseded =
    Boolean(existing) &&
    Boolean(assessment) &&
    existing!.assessment_id !== assessment!.id;

  if (reviewState === "closed") {
    return <ClosedReportLink reviewId={reviewId} />;
  }

  if (existing && reviewState === "decided") {
    return (
      <div className={styles.panel}>
        <p className={styles.done}>
          Submitted · <strong>{existing.outcome.replaceAll("_", " ")}</strong>
          {existing.conditions ? ` — ${existing.conditions}` : ""}
        </p>
        <p className={styles.hint}>
          Evidence frozen at {new Date(existing.submitted_at).toLocaleString()}.
        </p>
        <button
          type="button"
          className={`btn btn-primary ${styles.submit}`}
          disabled={closing}
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
        {closeError && <p className={styles.error}>{closeError}</p>}
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
      <DecisionForm
        key={assessment.id}
        reviewId={reviewId}
        assessment={assessment}
      />
    </div>
  );
}
