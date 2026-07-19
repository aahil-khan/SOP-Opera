"use client";

import { useEffect, useMemo, useRef } from "react";
import { useLiveStore, type AgentStepEvent } from "@/lib/liveStore";
import styles from "./AgentBrainPanel.module.css";

const AGENT_LABELS: Record<string, string> = {
  scada: "SCADA",
  permit: "Permit",
  maintenance: "Maintenance",
  workforce: "Workforce",
  spatial: "Spatial",
  incident_pattern: "Incident",
  shift_handover: "Handover",
  orchestrator: "Orchestrator",
  sim_orchestrator: "Orch Sim",
  sim_scada: "Sim SCADA",
  sim_ptw: "Sim PTW",
  sim_maintenance: "Sim Maint",
  sim_workforce: "Sim Workforce",
};

function kindClass(kind: string): string {
  if (kind === "verdict") return styles.kindVerdict;
  if (kind === "error") return styles.kindError;
  if (kind === "tool_call") return styles.kindTool;
  if (kind === "local_risk") return styles.kindRisk;
  return styles.kindDefault;
}

function StepRow({ step }: { step: AgentStepEvent }) {
  const label = AGENT_LABELS[step.agent] ?? step.agent;
  const isClearance = step.finding === "clearance";
  return (
    <li
      className={styles.step}
      data-kind={step.kind}
      data-agent={step.agent}
      data-finding={step.finding}
    >
      <span className={styles.agent}>{label}</span>
      {isClearance ? (
        <span className={`${styles.kind} ${styles.kindClearance}`}>Clear</span>
      ) : (
        <span className={`${styles.kind} ${kindClass(step.kind)}`}>
          {step.kind}
        </span>
      )}
      <p className={styles.message}>{step.message}</p>
    </li>
  );
}

interface AgentBrainPanelProps {
  /** Limit the stream to steps for this review (asset-scoped investigation). */
  reviewId: string;
}

/**
 * Live multi-agent reasoning stream scoped to one review.
 * Rendered inside the asset drawer while assessment is in progress.
 */
export function AgentBrainPanel({ reviewId }: AgentBrainPanelProps) {
  const allSteps = useLiveStore((s) => s.agentSteps);
  const listRef = useRef<HTMLUListElement>(null);

  const steps = useMemo(
    () => allSteps.filter((s) => s.review_id === reviewId),
    [allSteps, reviewId],
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [steps.length]);

  const verdict = [...steps].reverse().find((s) => s.kind === "verdict");
  const pinnedClearances = useMemo(() => {
    if (!verdict) return [];
    return steps.filter(
      (s) =>
        s.finding === "clearance" &&
        (s.agent === "orchestrator" ||
          /no (active|hot-work|matching)/i.test(s.message)),
    );
  }, [steps, verdict]);

  return (
    <div className={styles.embedded} aria-label="Agent reasoning stream">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.mark}>Brain</span>
          <h3 className={styles.title}>Agent stream</h3>
          {steps.length > 0 && (
            <span className={styles.count}>{steps.length}</span>
          )}
        </div>
      </header>

      {verdict && (
        <p className={styles.verdictBanner}>{verdict.message}</p>
      )}
      {pinnedClearances.length > 0 && (
        <div className={styles.clearancePin} aria-label="Clearance findings">
          <span className={styles.clearancePinLabel}>
            Clearances · not causal for alert
          </span>
          <ul className={styles.clearancePinList}>
            {pinnedClearances.slice(-4).map((s) => (
              <li key={s.id}>{s.message}</li>
            ))}
          </ul>
        </div>
      )}
      {steps.length === 0 ? (
        <p className={styles.empty}>
          Agents are starting… reasoning steps for this review will stream here.
        </p>
      ) : (
        <ul className={styles.list} ref={listRef}>
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
