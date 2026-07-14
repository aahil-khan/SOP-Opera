"use client";

import { useMemo, useState } from "react";
import type { Assessment, Decision } from "@/shared/schemas";
import type { DecisionOutcome } from "@/shared/enums";
import { useDemoStore } from "@/lib/demoStore";
import styles from "./DecisionPanel.module.css";

interface DecisionPanelProps {
  reviewId: string;
  assessment: Assessment | null;
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
  assessment: Assessment;
}) {
  const submitDecision = useDemoStore((s) => s.submitDecision);
  const [outcome, setOutcome] = useState<DecisionOutcome>("blocked");
  const [conditions, setConditions] = useState("");
  const initialDispositions = useMemo(() => {
    const map: Record<string, "accepted" | "rejected"> = {};
    for (const rec of assessment.recommendations) {
      map[rec.id] = "accepted";
    }
    return map;
  }, [assessment]);
  const [dispositions, setDispositions] = useState(initialDispositions);

  const needsConditions = outcome === "approved_with_conditions";
  const canSubmit = !needsConditions || conditions.trim().length > 0;

  return (
    <div className={`panel ${styles.panel}`}>
      <h3 className={styles.title}>Decision</h3>
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

      <div>
        <p className={styles.label}>Recommendation dispositions</p>
        {assessment.recommendations.map((rec) => (
          <div key={rec.id} className={styles.dispRow}>
            <span>{rec.text}</span>
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

      <div>
        <p className={styles.label}>Conditions</p>
        <textarea
          className={styles.textarea}
          disabled={!needsConditions}
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
          placeholder={
            needsConditions
              ? "Required for approved with conditions…"
              : "Enable by choosing Approved w/ conditions"
          }
        />
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={!canSubmit}
        onClick={() =>
          submitDecision(
            reviewId,
            outcome,
            dispositions,
            needsConditions ? conditions.trim() : null,
          )
        }
      >
        Submit decision (local)
      </button>
      <p className={styles.hint}>
        Phase 1: local mock only — does not call the API.
      </p>
    </div>
  );
}

export function DecisionPanel({
  reviewId,
  assessment,
  existing,
}: DecisionPanelProps) {
  if (existing) {
    return (
      <div className={`panel ${styles.panel}`}>
        <h3 className={styles.title}>Decision</h3>
        <p className={styles.done}>
          Submitted · <strong>{existing.outcome.replaceAll("_", " ")}</strong>
          {existing.conditions ? ` — ${existing.conditions}` : ""}
        </p>
        <p className={styles.hint}>
          Evidence frozen at {new Date(existing.submitted_at).toLocaleString()}{" "}
          (local mock — Phase 4 wires the backend).
        </p>
      </div>
    );
  }

  if (!assessment || assessment.status !== "complete") {
    return (
      <div className={`panel ${styles.panel}`}>
        <h3 className={styles.title}>Decision</h3>
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
