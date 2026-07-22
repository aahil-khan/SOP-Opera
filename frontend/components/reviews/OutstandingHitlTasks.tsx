import type { Decision, Recommendation } from "@/shared/schemas";
import type { ReviewTaskBrief } from "@/lib/liveApi";
import actionStyles from "@/components/decision/RecommendedAction.module.css";

function statusLabel(status: ReviewTaskBrief["status"]): string {
  return status.replaceAll("_", " ");
}

export function outstandingHitlTasks(
  tasks: ReviewTaskBrief[] | null | undefined,
): ReviewTaskBrief[] {
  return (tasks ?? []).filter(
    (t) => t.status === "open" || t.status === "acknowledged",
  );
}

export function acceptedRecommendationsForDecision(
  decision: Decision | null | undefined,
  recommendations: Recommendation[],
): Recommendation[] {
  if (!decision) return recommendations;
  return recommendations.filter(
    (rec) => decision.recommendation_dispositions[rec.id] !== "rejected",
  );
}

function isGenericTaskDetail(detail: string | null | undefined): boolean {
  if (!detail?.trim()) return true;
  return /^Decision outcome:/i.test(detail.trim());
}

interface OutstandingHitlTasksProps {
  tasks: ReviewTaskBrief[] | null | undefined;
  decision?: Decision | null;
  recommendations?: Recommendation[];
}

export function OutstandingHitlTasks({
  tasks,
  decision = null,
  recommendations = [],
}: OutstandingHitlTasksProps) {
  const outstanding = outstandingHitlTasks(tasks);
  if (outstanding.length === 0) return null;

  const accepted = acceptedRecommendationsForDecision(decision, recommendations);
  const conditions = decision?.conditions?.trim() || null;
  const comments = decision?.comments?.trim() || null;
  const hasUnblock = outstanding.some((t) => t.task_type === "unblock");
  const hasRichContext =
    accepted.length > 0 || Boolean(conditions) || Boolean(comments) || hasUnblock;

  return (
    <div className={actionStyles.hitlBlock}>
      {hasRichContext ? (
        <div className={actionStyles.taskWorkBlock}>
          <p className={actionStyles.taskWorkLabel}>What to execute</p>
          {hasUnblock ? (
            <p className={actionStyles.taskWorkLead}>
              Clear the physical lockout and make the asset safe to restart.
            </p>
          ) : null}
          {accepted.length > 0 ? (
            <ol className={actionStyles.taskActionList}>
              {accepted.map((rec) => (
                <li key={rec.id} className={actionStyles.taskActionItem}>
                  <p className={actionStyles.taskActionText}>{rec.text}</p>
                  {rec.rationale ? (
                    <p className={actionStyles.taskActionRationale}>
                      {rec.rationale}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {conditions ? (
            <p className={actionStyles.taskConditions}>
              <strong>Conditions:</strong> {conditions}
            </p>
          ) : null}
          {comments ? (
            <p className={actionStyles.taskComments}>
              <strong>Operator note:</strong> {comments}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={actionStyles.taskAssigneeBlock}>
        <p className={actionStyles.taskWorkLabel}>Waiting on</p>
        <ul className={actionStyles.taskList} aria-label="Outstanding follow-up tasks">
          {outstanding.map((task) => {
            const fallbackDetail =
              !isGenericTaskDetail(task.detail) && !hasRichContext
                ? task.detail
                : null;
            return (
              <li key={task.id} className={actionStyles.taskItem}>
                <div className={actionStyles.taskBody}>
                  <p className={actionStyles.taskTitle}>
                    {task.assigned_worker_name ?? "Assigned worker"}
                  </p>
                  {fallbackDetail ? (
                    <p className={actionStyles.taskDetail}>{fallbackDetail}</p>
                  ) : (
                    <p className={actionStyles.taskDetail}>
                      {task.task_type === "unblock"
                        ? "Confirm the asset is safe to restart."
                        : "Carry out the actions above and mark done on the supervisor board."}
                    </p>
                  )}
                </div>
                <span
                  className={actionStyles.taskStatus}
                  data-status={task.status}
                >
                  {statusLabel(task.status)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
