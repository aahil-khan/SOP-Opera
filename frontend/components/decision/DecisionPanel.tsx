"use client";

import { useEffect, useRef, useState } from "react";
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

const OUTCOMES: { value: DecisionOutcome; label: string }[] = [
  { value: "approved", label: "Approved" },
  { value: "approved_with_conditions", label: "Approved w/ conditions" },
  { value: "blocked", label: "Blocked" },
];

function DecisionForm({
  reviewId,
  assessment,
}: {
  reviewId: string;
  assessment: AssessmentHistoryItem;
}) {
  const submitDecision = useLiveStore((s) => s.submitDecision);
  const [outcome, setOutcome] = useState<DecisionOutcome>("blocked");
  const [conditions, setConditions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conditionsRef = useRef<HTMLDivElement>(null);
  const initialDispositions: Record<string, "accepted" | "rejected"> =
    Object.fromEntries(
      assessment.recommendations.map((rec) => [rec.id, "accepted" as const]),
    );
  const [dispositions, setDispositions] = useState(initialDispositions);

  const needsConditions = outcome === "approved_with_conditions";
  const canSubmit = !needsConditions || conditions.trim().length > 0;

  useEffect(() => {
    if (!needsConditions) return;
    const el = conditionsRef.current;
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [needsConditions]);

  async function onSubmit() {
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
      <p className={styles.label}>Outcome</p>
      <div className={styles.outcomes}>
        {OUTCOMES.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`btn ${styles.outcome}`}
            data-active={outcome === o.value}
            data-outcome={o.value}
            onClick={() => setOutcome(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {assessment.recommendations.length > 0 && (
        <div className={styles.block}>
          <p className={styles.label}>Dispositions</p>
          <div className={styles.dispList}>
            {assessment.recommendations.map((rec) => (
              <div key={rec.id} className={styles.dispRow}>
                <span className={styles.dispText}>{rec.text}</span>
                <div className={styles.toggles}>
                  {(["accepted", "rejected"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`btn ${styles.toggle}`}
                      data-active={dispositions[rec.id] === kind}
                      data-kind={kind}
                      onClick={() =>
                        setDispositions((d) => ({ ...d, [rec.id]: kind }))
                      }
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {needsConditions && (
        <div ref={conditionsRef} className={styles.block}>
          <p className={styles.label}>Conditions</p>
          <textarea
            className={styles.textarea}
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            rows={2}
            placeholder="Required for approved with conditions…"
          />
        </div>
      )}

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

  if (existing) {
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

  const canDecide =
    (reviewState === "pending_decision" || reviewState === "escalated") &&
    assessment?.status === "complete";

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
    <DecisionForm
      key={assessment.id}
      reviewId={reviewId}
      assessment={assessment}
    />
  );
}
