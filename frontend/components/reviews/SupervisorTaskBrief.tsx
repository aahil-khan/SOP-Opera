"use client";

import type { Decision, Recommendation } from "@/shared/schemas";
import type { ReviewTask } from "@/lib/liveApi";
import { displayPersonName } from "@/lib/personName";
import styles from "./SupervisorTaskBrief.module.css";

function outcomeRisk(
  outcome: string | null | undefined,
): "blocking" | "elevated" | "nominal" {
  if (outcome === "blocked") return "blocking";
  if (outcome === "approved_with_conditions") return "elevated";
  return "nominal";
}

function taskInstruction(task: ReviewTask): string {
  if (task.task_type === "unblock") {
    return "Clear the physical lockout / make the asset safe to restart, then mark this task done with a short evidence note.";
  }
  if (task.decision_conditions?.trim()) {
    return "Carry out the conditions below, then mark this task done with what you verified.";
  }
  return "Complete the follow-up on the floor, then mark this task done with a short evidence note.";
}

interface SupervisorTaskBriefProps {
  decision: Decision | null;
  task: ReviewTask | null;
  decidedByName?: string | null;
  recommendations?: Recommendation[];
}

export function SupervisorTaskBrief({
  decision,
  task,
  decidedByName = null,
  recommendations = [],
}: SupervisorTaskBriefProps) {
  if (!decision && !task) return null;

  const outcome = decision?.outcome ?? task?.decision_outcome ?? null;
  const conditions =
    decision?.conditions?.trim() || task?.decision_conditions?.trim() || null;
  const comments =
    decision?.comments?.trim() || task?.decision_comments?.trim() || null;
  const submittedAt =
    decision?.submitted_at ?? task?.decision_submitted_at ?? null;
  const risk = outcomeRisk(outcome);
  const operatorName = decidedByName ?? task?.decision_decided_by_name ?? null;
  const operatorLabel = operatorName ? displayPersonName(operatorName) : null;

  const accepted = recommendations.filter((rec) => {
    if (!decision) return true;
    const disposition = decision.recommendation_dispositions[rec.id];
    return disposition !== "rejected";
  });

  return (
    <section className={styles.root} aria-labelledby="supervisor-brief-heading">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Your action</p>
        <h3 id="supervisor-brief-heading" className={styles.title}>
          {task
            ? task.task_type === "unblock"
              ? "Unblock machine"
              : "Follow-up actions"
            : "Operator decision"}
        </h3>
      </header>

      {outcome ? (
        <div className={styles.decisionBlock}>
          <p className={styles.sectionLabel}>Operator decision</p>
          <p className={styles.outcomeRow}>
            <span className="badge" data-risk={risk}>
              {outcome.replaceAll("_", " ")}
            </span>
            {operatorLabel ? (
              <span className={styles.meta}>by {operatorLabel}</span>
            ) : null}
            {submittedAt ? (
              <span className={styles.meta}>
                · {new Date(submittedAt).toLocaleString()}
              </span>
            ) : null}
          </p>
          {conditions ? (
            <p className={styles.conditions}>
              <strong>Conditions:</strong> {conditions}
            </p>
          ) : null}
          {comments ? <p className={styles.comments}>{comments}</p> : null}
        </div>
      ) : null}

      {task ? (
        <div className={styles.taskBlock}>
          <p className={styles.sectionLabel}>What you need to do</p>
          <p className={styles.instruction}>{taskInstruction(task)}</p>
          {task.detail ? (
            <p className={styles.taskDetail}>{task.detail}</p>
          ) : null}
          <p className={styles.taskStatus}>
            Status:{" "}
            <strong>{task.status.replaceAll("_", " ")}</strong>
            {task.status === "open"
              ? " — acknowledge on the board, then complete with a done note."
              : task.status === "acknowledged"
                ? " — add a done note on the board when finished."
                : task.done_note
                  ? ` — ${task.done_note}`
                  : ""}
          </p>
        </div>
      ) : null}

      {accepted.length > 0 ? (
        <div className={styles.actionsBlock}>
          <p className={styles.sectionLabel}>Accepted actions</p>
          <ol className={styles.actionList}>
            {accepted.map((rec) => (
              <li key={rec.id} className={styles.actionItem}>
                <p className={styles.actionText}>{rec.text}</p>
                {rec.rationale ? (
                  <p className={styles.actionRationale}>{rec.rationale}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
