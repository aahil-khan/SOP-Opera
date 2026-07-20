"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAgentStepsForReview,
  type AgentStepEvent,
  type AgentStepKind,
} from "@/lib/liveStore";
import styles from "./AgentBrainPanel.module.css";

const AGENT_LABELS: Record<string, string> = {
  scada: "SCADA",
  permit: "Permit",
  maintenance: "Maintenance",
  workforce: "Workforce",
  predictive_trend: "Forecast",
  spatial: "Spatial",
  incident_pattern: "Incident",
  shift_handover: "Handover",
  orchestrator: "Orchestrator",
  sim_orchestrator: "Orch Sim",
  sim_scada: "Sim SCADA",
  sim_ptw: "Sim Permit to Work",
  sim_maintenance: "Sim Maintenance",
  sim_workforce: "Sim Workforce",
};

const KIND_LABELS: Record<AgentStepKind, string> = {
  started: "Starting",
  tool_call: "Checking",
  observation: "Found",
  local_risk: "Risk signal",
  verdict: "Verdict",
  completed: "Done",
  error: "Error",
};

function kindClass(kind: string): string {
  if (kind === "verdict") return styles.kindVerdict;
  if (kind === "error") return styles.kindError;
  if (kind === "tool_call") return styles.kindTool;
  if (kind === "observation") return styles.kindObs;
  if (kind === "local_risk") return styles.kindRisk;
  if (kind === "started") return styles.kindStarted;
  if (kind === "completed") return styles.kindDone;
  return styles.kindDefault;
}

function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent;
}

function formatLeadTime(seconds: number): string {
  if (seconds <= 0) return "at incident threshold now";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  return mins === 1 ? "~1 min" : `~${mins} min`;
}

function leadTimeLine(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  const forecasts = Array.isArray(detail.trend_forecasts)
    ? (detail.trend_forecasts as Array<Record<string, unknown>>)
    : [];
  const bestForecast = forecasts
    .filter(
      (f) =>
        typeof f.seconds_to_critical === "number" &&
        Number.isFinite(f.seconds_to_critical as number) &&
        typeof f.r_squared === "number",
    )
    .sort(
      (a, b) =>
        (a.seconds_to_critical as number) - (b.seconds_to_critical as number),
    )[0];
  if (bestForecast) {
    const metric =
      typeof bestForecast.metric === "string"
        ? bestForecast.metric.replaceAll("_", " ")
        : "sensor";
    const eta = bestForecast.seconds_to_critical as number;
    const r2 = bestForecast.r_squared as number;
    if (eta > 0) {
      return `${metric} projected to hit critical in ${formatLeadTime(eta)} (R²=${r2.toFixed(2)}).`;
    }
    if (eta <= 0) {
      return `${metric} at or above critical threshold (R²=${r2.toFixed(2)}).`;
    }
  }
  const grounded = detail.grounded_fact_types;
  const hasElevated =
    Array.isArray(grounded) && grounded.includes("elevated_gas");
  const hasCritical =
    Array.isArray(grounded) &&
    (grounded.includes("critical_gas") || grounded.includes("critical_temperature"));
  const raw = detail.lead_time_seconds;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw <= 0 && hasCritical) {
      return "Single-sensor critical threshold already crossed.";
    }
    if (raw > 0) {
      return `Compound flagged ${formatLeadTime(raw)} before single-sensor critical threshold.`;
    }
  }
  if (hasElevated && !hasCritical) {
    return "Compound blocked before single-sensor critical threshold.";
  }
  return null;
}

function StepRow({
  step,
  variant,
}: {
  step: AgentStepEvent;
  variant: "current" | "history";
}) {
  const label = agentLabel(step.agent);
  const kindLabel =
    step.finding === "clearance"
      ? "Clear"
      : (KIND_LABELS[step.kind] ?? step.kind);
  const isClearance = step.finding === "clearance";

  return (
    <li
      className={styles.step}
      data-kind={step.kind}
      data-agent={step.agent}
      data-finding={step.finding}
      data-variant={variant}
    >
      <div className={styles.stepMeta}>
        <span className={styles.agent}>{label}</span>
        <span
          className={`${styles.kind} ${
            isClearance ? styles.kindClearance : kindClass(step.kind)
          }`}
        >
          {kindLabel}
        </span>
      </div>
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
 * Default: only the latest step. "History" expands the full step list from the start.
 */
export function AgentBrainPanel({ reviewId }: AgentBrainPanelProps) {
  const steps = useAgentStepsForReview(reviewId);
  const listRef = useRef<HTMLUListElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setShowHistory(false);
  }, [reviewId]);

  const current = steps[steps.length - 1] ?? null;
  const history = showHistory ? steps.slice(0, -1) : [];
  const priorCount = Math.max(0, steps.length - 1);
  const canToggle = steps.length > 1;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [current?.id, showHistory, steps.length]);

  const verdict = useMemo(
    () => [...steps].reverse().find((s) => s.kind === "verdict"),
    [steps],
  );
  const verdictLeadTime = useMemo(
    () => (verdict ? leadTimeLine(verdict.detail) : null),
    [verdict],
  );
  const pinnedClearances = useMemo(() => {
    if (!verdict) return [];
    return steps.filter(
      (s) =>
        s.finding === "clearance" &&
        (s.agent === "orchestrator" ||
          /no (active|hot-work|matching)/i.test(s.message)),
    );
  }, [steps, verdict]);

  const statusLine = current
    ? `${agentLabel(current.agent)} · ${
        current.finding === "clearance"
          ? "Clearance"
          : (KIND_LABELS[current.kind] ?? current.kind)
      }`
    : "Waiting for domain signals…";

  return (
    <div className={styles.embedded} aria-label="Agent reasoning stream">
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.liveDot} aria-hidden />
          <h3 className={styles.title}>Live reasoning</h3>
          {steps.length > 0 && (
            <span className={styles.count}>{steps.length}</span>
          )}
        </div>
        {canToggle && (
          <button
            type="button"
            className={styles.replayBtn}
            aria-pressed={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Latest only" : "History"}
          </button>
        )}
        <p className={styles.statusLine}>{statusLine}</p>
      </header>

      {verdict && (
        <>
          <p className={styles.verdictBanner}>{verdict.message}</p>
          {verdictLeadTime && (
            <p className={styles.leadTimeBanner}>{verdictLeadTime}</p>
          )}
        </>
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
        <div className={styles.empty}>
          <span className={styles.emptyPulse} aria-hidden />
          <p>Agents are starting — steps will appear here as they run.</p>
        </div>
      ) : (
        <ul className={styles.list} ref={listRef}>
          {!showHistory && priorCount > 0 && (
            <li className={styles.hiddenHint}>
              {priorCount} prior step{priorCount === 1 ? "" : "s"}
            </li>
          )}
          {history.map((s) => (
            <StepRow key={s.id} step={s} variant="history" />
          ))}
          {current ? (
            <StepRow key={current.id} step={current} variant="current" />
          ) : null}
        </ul>
      )}
    </div>
  );
}
