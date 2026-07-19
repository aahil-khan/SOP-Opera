"use client";

import { useEffect, useRef, useState } from "react";
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
  return (
    <li className={styles.step} data-kind={step.kind} data-agent={step.agent}>
      <span className={styles.agent}>{label}</span>
      <span className={`${styles.kind} ${kindClass(step.kind)}`}>{step.kind}</span>
      <p className={styles.message}>{step.message}</p>
    </li>
  );
}

interface AgentBrainPanelProps {
  shiftForDrawer?: boolean;
}

export function AgentBrainPanel({ shiftForDrawer = false }: AgentBrainPanelProps) {
  const steps = useLiveStore((s) => s.agentSteps);
  const clearAgentSteps = useLiveStore((s) => s.clearAgentSteps);
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !open) return;
    el.scrollTop = el.scrollHeight;
  }, [steps.length, open]);

  const verdict = [...steps].reverse().find((s) => s.kind === "verdict");

  return (
    <aside
      className={styles.panel}
      data-open={open ? "true" : "false"}
      data-shift={shiftForDrawer ? "true" : undefined}
      aria-label="Agent reasoning stream"
    >
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.mark}>Brain</span>
          <h2 className={styles.title}>Agent stream</h2>
          {steps.length > 0 && (
            <span className={styles.count}>{steps.length}</span>
          )}
        </div>
        <div className={styles.actions}>
          {steps.length > 0 && (
            <button
              type="button"
              className={styles.ghost}
              onClick={clearAgentSteps}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className={styles.ghost}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </header>

      {open && (
        <>
          {verdict && (
            <p className={styles.verdictBanner}>{verdict.message}</p>
          )}
          {steps.length === 0 ? (
            <p className={styles.empty}>
              Start a demo scenario. Multi-agent reasoning will stream here live.
            </p>
          ) : (
            <ul className={styles.list} ref={listRef}>
              {steps.map((s) => (
                <StepRow key={s.id} step={s} />
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
