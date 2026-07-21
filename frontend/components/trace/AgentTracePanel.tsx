"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import {
  useAgentStepsForReview,
  type AgentStepEvent,
  type AgentStepKind,
} from "@/lib/liveStore";
import { normalizeAgentTrace } from "@/lib/reasoningGraph";
import styles from "./AgentTracePanel.module.css";

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

const AGENT_ROLES: Record<string, string> = {
  scada: "Checks live sensor readings",
  sim_scada: "Checks live sensor readings",
  permit: "Reviews active permits & hot work",
  sim_ptw: "Reviews active permits & hot work",
  maintenance: "Cross-checks maintenance state",
  sim_maintenance: "Cross-checks maintenance state",
  workforce: "Looks at crew & ownership",
  sim_workforce: "Looks at crew & ownership",
  predictive_trend: "Projects sensor trends toward thresholds",
  spatial: "Correlates nearby hazards by distance/floor",
  incident_pattern: "Matches known incident patterns",
  shift_handover: "Checks carry-forward from the previous shift",
  orchestrator: "Synthesizes findings into a verdict",
  sim_orchestrator: "Synthesizes findings into a verdict",
};

type PipelinePhaseId = "sources" | "analysis" | "verdict" | "enrichment";

const PIPELINE_PHASES: {
  id: PipelinePhaseId;
  title: string;
  blurb: string;
  agents: string[];
}[] = [
  {
    id: "sources",
    title: "Sources",
    blurb: "Domain scanners",
    agents: [
      "scada",
      "sim_scada",
      "permit",
      "sim_ptw",
      "maintenance",
      "sim_maintenance",
      "workforce",
      "sim_workforce",
    ],
  },
  {
    id: "analysis",
    title: "Analysis",
    blurb: "Neighborhood & forecast",
    agents: ["spatial", "predictive_trend", "shift_handover"],
  },
  {
    id: "verdict",
    title: "Verdict",
    blurb: "Compound judgment",
    agents: ["orchestrator", "sim_orchestrator"],
  },
  {
    id: "enrichment",
    title: "Enrichment",
    blurb: "Post-verdict context",
    agents: ["incident_pattern"],
  },
];

const AGENT_PHASE = new Map<string, PipelinePhaseId>(
  PIPELINE_PHASES.flatMap((p) => p.agents.map((a) => [a, p.id] as const)),
);

const CANONICAL_AGENT_ORDER = PIPELINE_PHASES.flatMap((p) => p.agents);

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

/** Compact labels for the narrow flow rail */
function flowLabel(agent: string): string {
  const short: Record<string, string> = {
    orchestrator: "Orch",
    sim_orchestrator: "Orch Sim",
    predictive_trend: "Forecast",
    incident_pattern: "Incident",
    shift_handover: "Handover",
    sim_maintenance: "Maint",
    maintenance: "Maint",
    workforce: "Crew",
    sim_workforce: "Crew",
    sim_ptw: "Permit",
    sim_scada: "SCADA",
  };
  return short[agent] ?? AGENT_LABELS[agent] ?? agent;
}

function agentRole(agent: string): string {
  return AGENT_ROLES[agent] ?? "Contributes to the investigation";
}

function contentSteps(steps: AgentStepEvent[]): AgentStepEvent[] {
  return steps.filter((s) => s.kind !== "started" && s.kind !== "completed");
}

function canonicalAgentIndex(agent: string): number {
  const idx = CANONICAL_AGENT_ORDER.indexOf(agent);
  return idx >= 0 ? idx : CANONICAL_AGENT_ORDER.length + 1;
}

function groupByAgentCanonical(steps: AgentStepEvent[]): {
  agent: string;
  steps: AgentStepEvent[];
}[] {
  const map = new Map<string, AgentStepEvent[]>();
  for (const s of steps) {
    if (!map.has(s.agent)) map.set(s.agent, []);
    map.get(s.agent)!.push(s);
  }
  return [...map.entries()]
    .map(([agent, agentSteps]) => ({ agent, steps: agentSteps }))
    .filter((g) => contentSteps(g.steps).length > 0)
    .sort(
      (a, b) =>
        canonicalAgentIndex(a.agent) - canonicalAgentIndex(b.agent) ||
        a.agent.localeCompare(b.agent),
    );
}

function groupIntoPhases(
  groups: { agent: string; steps: AgentStepEvent[] }[],
): {
  id: PipelinePhaseId | "other";
  title: string;
  blurb: string;
  groups: { agent: string; steps: AgentStepEvent[] }[];
}[] {
  const byPhase = new Map<
    PipelinePhaseId | "other",
    { agent: string; steps: AgentStepEvent[] }[]
  >();

  for (const g of groups) {
    const phase = AGENT_PHASE.get(g.agent) ?? "other";
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase)!.push(g);
  }

  const ordered: {
    id: PipelinePhaseId | "other";
    title: string;
    blurb: string;
    groups: { agent: string; steps: AgentStepEvent[] }[];
  }[] = [];

  for (const phase of PIPELINE_PHASES) {
    const phaseGroups = byPhase.get(phase.id);
    if (phaseGroups && phaseGroups.length > 0) {
      ordered.push({
        id: phase.id,
        title: phase.title,
        blurb: phase.blurb,
        groups: phaseGroups,
      });
    }
  }

  const other = byPhase.get("other");
  if (other && other.length > 0) {
    ordered.push({
      id: "other",
      title: "Other",
      blurb: "Additional agents",
      groups: other,
    });
  }

  return ordered;
}

function groupTone(
  _agent: string,
  steps: AgentStepEvent[],
): "risk" | "clearance" | "verdict" | "neutral" {
  if (steps.some((s) => s.kind === "verdict")) return "verdict";
  if (
    steps.some(
      (s) =>
        s.finding === "risk" || s.kind === "local_risk" || s.kind === "error",
    )
  ) {
    return "risk";
  }
  if (steps.length > 0 && steps.every((s) => s.finding === "clearance")) {
    return "clearance";
  }
  return "neutral";
}

function agentHeadline(steps: AgentStepEvent[]): AgentStepEvent | null {
  const verdict = steps.find((s) => s.kind === "verdict");
  if (verdict) return verdict;
  const obs = [...steps].reverse().find((s) => s.kind === "observation");
  if (obs) return obs;
  const risk = steps.find((s) => s.kind === "local_risk");
  if (risk) return risk;
  const err = steps.find((s) => s.kind === "error");
  if (err) return err;
  return steps[0] ?? null;
}

function StepRow({
  step,
  inProgress = false,
}: {
  step: AgentStepEvent;
  inProgress?: boolean;
}) {
  const isClearance = step.finding === "clearance";
  const kindLabel = isClearance
    ? "Clear"
    : step.kind === "verdict" && inProgress
      ? "Draft verdict"
      : (KIND_LABELS[step.kind] ?? step.kind);

  return (
    <li
      className={styles.step}
      data-kind={step.kind}
      data-finding={step.finding}
    >
      <span
        className={`${styles.kind} ${
          isClearance ? styles.kindClearance : kindClass(step.kind)
        }`}
      >
        {kindLabel}
      </span>
      <p className={styles.message}>{step.message}</p>
    </li>
  );
}

function AgentGroup({
  agent,
  steps,
  focused,
  dimmed,
  groupRef,
  inProgress = false,
}: {
  agent: string;
  steps: AgentStepEvent[];
  focused: boolean;
  dimmed: boolean;
  groupRef: (el: HTMLElement | null) => void;
  inProgress?: boolean;
}) {
  const visible = contentSteps(steps);
  if (visible.length === 0) return null;

  const tone = groupTone(agent, visible);
  const headline = agentHeadline(visible);
  const detailSteps = headline
    ? visible.filter((s) => s.id !== headline.id)
    : visible;

  const focusAttrs = {
    ref: groupRef,
    "data-agent": agent,
    "data-tone": tone,
    "data-focused": focused ? "true" : undefined,
    "data-dimmed": dimmed ? "true" : undefined,
  } as const;

  return (
    <section className={styles.group} {...focusAttrs}>
      <div className={styles.groupHeader}>
        <span className={styles.groupAgent}>{agentLabel(agent)}</span>
        <span className={styles.groupRole}>{agentRole(agent)}</span>
        <span className={styles.groupTone} data-tone={tone}>
          {tone === "verdict"
            ? "Verdict"
            : tone === "risk"
              ? "Risk"
              : tone === "clearance"
                ? "Clear"
                : "Neutral"}
        </span>
      </div>
      {headline ? (
        <p className={styles.headline} data-kind={headline.kind}>
          {headline.message}
        </p>
      ) : null}
      {detailSteps.length > 0 ? (
        <details className={styles.stepDetails}>
          <summary className={styles.stepDetailsSummary}>
            {detailSteps.length} detail
            {detailSteps.length === 1 ? "" : "s"}
          </summary>
          <ul className={styles.stepList}>
            {detailSteps.map((s) => (
              <StepRow key={s.id} step={s} inProgress={inProgress} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function agentAccentVar(agent: string): string {
  if (agent === "scada" || agent === "sim_scada") return "var(--domain-sensors)";
  if (agent === "permit" || agent === "sim_ptw") return "var(--domain-permits)";
  if (
    agent === "workforce" ||
    agent === "sim_workforce" ||
    agent === "maintenance" ||
    agent === "sim_maintenance"
  ) {
    return "var(--domain-people)";
  }
  if (agent === "spatial" || agent === "predictive_trend") {
    return "var(--domain-spatial)";
  }
  if (agent === "incident_pattern" || agent === "shift_handover") {
    return "var(--domain-evidence)";
  }
  return "var(--accent-ai)";
}

type FlowNodeModel = {
  agent: string;
  count: number;
  tone: string;
};

type SimNode = FlowNodeModel & {
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Per-node phase seeds for idle drift */
  phaseX: number;
  phaseY: number;
  freqX: number;
  freqY: number;
};

const FLOW_PAD_X = 56;
const FLOW_PAD_Y = 32;
/** Minimum vertical spacing so bubble pills do not overlap */
const FLOW_MIN_ROW_GAP = 32;
const FLOW_MAX_PULL = 20;
const FLOW_SPRING = 0.12;
const FLOW_DAMP = 0.82;
/** Idle float amplitude (px) around the home slot — keep small so labels stay in-bounds */
const FLOW_IDLE_AMP_X = 2.2;
const FLOW_IDLE_AMP_Y = 2.4;
const FLOW_HIT_RADIUS = 40;
const FLOW_FALLBACK_W = 168;

function flowAccent(agent: string, tone: string): string {
  if (tone === "risk") return "var(--status-elevated)";
  if (tone === "verdict") return "var(--status-blocking)";
  if (tone === "clearance") return "var(--status-nominal)";
  return agentAccentVar(agent);
}

function RubberFlowGraph({
  nodes,
  focusedAgent,
  onFocus,
  onClear,
}: {
  nodes: FlowNodeModel[];
  focusedAgent: string | null;
  onFocus: (agent: string) => void;
  onClear: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<SimNode[]>([]);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const edgeEls = useRef<SVGLineElement[]>([]);
  const dragRef = useRef<{ agent: string; ox: number; oy: number } | null>(
    null,
  );
  const hoverRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const t0Ref = useRef(performance.now());
  const runningRef = useRef(false);
  const visibleRef = useRef(true);
  const viewportHRef = useRef(280);
  const contentHRef = useRef(280);
  const flowWRef = useRef(FLOW_FALLBACK_W);
  const [viewportH, setViewportH] = useState(280);
  const [flowW, setFlowW] = useState(FLOW_FALLBACK_W);

  const structureKey = nodes
    .map((n) => `${n.agent}:${n.count}:${n.tone}`)
    .join("|");
  const nCount = Math.max(nodes.length, 1);
  const minContentH =
    nCount <= 1
      ? viewportH
      : FLOW_PAD_Y * 2 + (nCount - 1) * FLOW_MIN_ROW_GAP;
  const contentH = Math.max(viewportH, minContentH);
  // Spread nodes across the full canvas height (and width via measured flowW).
  const rowGap =
    nCount <= 1 ? 0 : (contentH - FLOW_PAD_Y * 2) / (nCount - 1);
  const scrollable = contentH > viewportH + 1;

  useEffect(() => {
    contentHRef.current = contentH;
  }, [contentH]);

  useEffect(() => {
    flowWRef.current = flowW;
  }, [flowW]);

  const paint = useCallback(() => {
    const sim = simRef.current;
    for (const n of sim) {
      const el = bubbleEls.current.get(n.agent);
      if (!el) continue;
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
    }
    for (let i = 1; i < sim.length; i++) {
      const line = edgeEls.current[i - 1];
      const prev = sim[i - 1];
      const n = sim[i];
      if (!line || !prev || !n) continue;
      line.setAttribute("x1", String(prev.x));
      line.setAttribute("y1", String(prev.y));
      line.setAttribute("x2", String(n.x));
      line.setAttribute("y2", String(n.y));
    }
  }, []);

  const setDraggingAttr = useCallback((agent: string | null) => {
    for (const [id, el] of bubbleEls.current) {
      if (agent && id === agent) el.setAttribute("data-dragging", "true");
      else el.removeAttribute("data-dragging");
    }
  }, []);

  // Fill the flow column (matched to the detail pane via CSS).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const h = Math.floor(rect.height);
      const w = Math.floor(rect.width);
      if (h > 0) {
        viewportHRef.current = h;
        setViewportH(h);
      }
      if (w > 0) {
        flowWRef.current = w;
        setFlowW(w);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const next: SimNode[] = nodes.map((n, i) => {
      const stagger = ((i % 3) - 1) * Math.min(10, flowW * 0.04);
      const homeX = flowW / 2 + stagger;
      const homeY = FLOW_PAD_Y + i * rowGap;
      const prev = simRef.current.find((p) => p.agent === n.agent);
      return {
        ...n,
        homeX,
        homeY,
        x: prev?.x ?? homeX,
        y: prev?.y ?? homeY,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        phaseX: prev?.phaseX ?? i * 1.7 + 0.4,
        phaseY: prev?.phaseY ?? i * 2.3 + 0.7,
        freqX: prev?.freqX ?? 0.55 + (i % 4) * 0.12,
        freqY: prev?.freqY ?? 0.7 + (i % 3) * 0.15,
      };
    });
    simRef.current = next.map((n) => {
      const live = simRef.current.find((p) => p.agent === n.agent);
      return live
        ? { ...live, homeX: n.homeX, homeY: n.homeY, count: n.count, tone: n.tone }
        : n;
    });
    // Paint after React commits the new bubble/edge elements.
    requestAnimationFrame(() => paint());
  }, [structureKey, nodes, rowGap, flowW, paint]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const syncRunning = () => {
      const shouldRun =
        visibleRef.current &&
        !document.hidden &&
        simRef.current.length > 0;
      if (shouldRun === runningRef.current) return;
      runningRef.current = shouldRun;
      if (!shouldRun) {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        return;
      }
      const step = (now: number) => {
        if (!runningRef.current) return;
        const t = (now - t0Ref.current) / 1000;
        const dragging = dragRef.current?.agent ?? null;
        const h = contentHRef.current;
        const w = flowWRef.current;
        const clampPadX = Math.min(FLOW_PAD_X, Math.max(24, w / 2 - 8));
        for (const n of simRef.current) {
          if (n.agent === dragging) continue;

          const targetX =
            n.homeX + Math.sin(t * n.freqX + n.phaseX) * FLOW_IDLE_AMP_X;
          const targetY =
            n.homeY + Math.cos(t * n.freqY + n.phaseY) * FLOW_IDLE_AMP_Y;

          const ax = (targetX - n.x) * FLOW_SPRING;
          const ay = (targetY - n.y) * FLOW_SPRING;
          n.vx = (n.vx + ax) * FLOW_DAMP;
          n.vy = (n.vy + ay) * FLOW_DAMP;
          n.x += n.vx;
          n.y += n.vy;

          n.x = Math.min(w - clampPadX, Math.max(clampPadX, n.x));
          n.y = Math.min(h - 20, Math.max(20, n.y));
        }
        paint();
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    };

    const onVisibility = () => syncRunning();
    document.addEventListener("visibilitychange", onVisibility);

    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? false;
        syncRunning();
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    syncRunning();

    return () => {
      runningRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [paint, structureKey]);

  const clientToLocal = useCallback((clientX: number, clientY: number) => {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: clientX - r.left,
      y: clientY - r.top + el.scrollTop,
    };
  }, []);

  const nearestAgent = useCallback((x: number, y: number): string | null => {
    let best: string | null = null;
    let bestDist = FLOW_HIT_RADIUS;
    for (const n of simRef.current) {
      const d = Math.hypot(x - n.homeX, y - n.homeY);
      if (d < bestDist) {
        bestDist = d;
        best = n.agent;
      }
    }
    return best;
  }, []);

  const onCanvasPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const p = clientToLocal(e.clientX, e.clientY);
      const drag = dragRef.current;
      const h = contentHRef.current;
      if (drag) {
        const n = simRef.current.find((x) => x.agent === drag.agent);
        if (!n) return;
        let x = p.x - drag.ox;
        let y = p.y - drag.oy;
        const dx = x - n.homeX;
        const dy = y - n.homeY;
        const dist = Math.hypot(dx, dy);
        if (dist > FLOW_MAX_PULL) {
          const s = FLOW_MAX_PULL / dist;
          x = n.homeX + dx * s;
          y = n.homeY + dy * s;
        }
        const w = flowWRef.current;
        const clampPadX = Math.min(FLOW_PAD_X, Math.max(24, w / 2 - 8));
        n.x = Math.min(w - clampPadX, Math.max(clampPadX, x));
        n.y = Math.min(h - 20, Math.max(20, y));
        paint();
        return;
      }

      const hit = nearestAgent(p.x, p.y);
      if (hit !== hoverRef.current) {
        hoverRef.current = hit;
        if (hit) onFocus(hit);
        else onClear();
      }
    },
    [clientToLocal, nearestAgent, onClear, onFocus, paint],
  );

  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const p = clientToLocal(e.clientX, e.clientY);
      const agent = nearestAgent(p.x, p.y);
      if (!agent) return;
      const n = simRef.current.find((x) => x.agent === agent);
      if (!n) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { agent, ox: p.x - n.x, oy: p.y - n.y };
      n.vx = 0;
      n.vy = 0;
      hoverRef.current = agent;
      setDraggingAttr(agent);
      onFocus(agent);
    },
    [clientToLocal, nearestAgent, onFocus, setDraggingAttr],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (dragRef.current) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }
      dragRef.current = null;
      setDraggingAttr(null);
    },
    [setDraggingAttr],
  );

  const onCanvasLeave = useCallback(() => {
    if (dragRef.current) return;
    hoverRef.current = null;
    onClear();
  }, [onClear]);

  const setBubbleRef = useCallback(
    (agent: string, el: HTMLElement | null) => {
      if (el) bubbleEls.current.set(agent, el);
      else bubbleEls.current.delete(agent);
    },
    [],
  );

  const setEdgeRef = useCallback((index: number, el: SVGLineElement | null) => {
    if (el) edgeEls.current[index] = el;
    else delete edgeEls.current[index];
  }, []);

  // Snapshot for React structure only — animation paints via DOM refs.
  const sim = simRef.current.length === nodes.length
    ? simRef.current
    : nodes.map((n, i) => {
        const stagger = ((i % 3) - 1) * Math.min(10, flowW * 0.04);
        const homeX = flowW / 2 + stagger;
        const homeY = FLOW_PAD_Y + i * rowGap;
        return {
          ...n,
          homeX,
          homeY,
          x: homeX,
          y: homeY,
          vx: 0,
          vy: 0,
          phaseX: i * 1.7 + 0.4,
          phaseY: i * 2.3 + 0.7,
          freqX: 0.55 + (i % 4) * 0.12,
          freqY: 0.7 + (i % 3) * 0.15,
        };
      });

  return (
    <aside className={styles.flow} aria-label="Investigation flow">
      <p className={styles.flowTitle}>Flow</p>
      <div
        ref={wrapRef}
        className={styles.flowCanvas}
        data-scrollable={scrollable ? "true" : undefined}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onCanvasPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onCanvasLeave}
      >
        <div
          className={styles.flowInner}
          style={{ height: contentH, width: flowW }}
        >
          <svg
            className={styles.flowSvg}
            width={flowW}
            height={contentH}
            aria-hidden
          >
            {sim.slice(1).map((n, i) => {
              const prev = sim[i];
              if (!prev) return null;
              return (
                <line
                  key={`e-${prev.agent}-${n.agent}`}
                  ref={(el) => setEdgeRef(i, el)}
                  x1={prev.x}
                  y1={prev.y}
                  x2={n.x}
                  y2={n.y}
                  className={styles.flowEdge}
                />
              );
            })}
          </svg>
          {sim.map((n) => {
            const active = focusedAgent === n.agent;
            return (
              <div
                key={n.agent}
                ref={(el) => setBubbleRef(n.agent, el)}
                className={styles.flowBubble}
                data-active={active ? "true" : undefined}
                style={
                  {
                    left: n.x,
                    top: n.y,
                    "--flow-accent": flowAccent(n.agent, n.tone),
                  } as CSSProperties
                }
              >
                <span className={styles.flowDot} aria-hidden />
                <span className={styles.flowLabel}>{flowLabel(n.agent)}</span>
                <span className={styles.flowMeta}>{n.count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

interface AgentTracePanelProps {
  reviewId: string;
  assessment: AssessmentHistoryItem | null;
  /** Investigation still running — defer "finished" affordances. */
  inProgress?: boolean;
}

/**
 * Post-hoc agent investigation trace for Full Review.
 * Detail list + vertical flow overview; hover flow nodes to scroll/highlight.
 */
export function AgentTracePanel({
  reviewId,
  assessment,
  inProgress = false,
}: AgentTracePanelProps) {
  const liveSteps = useAgentStepsForReview(reviewId);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDetailsElement>(null);
  const groupEls = useRef(new Map<string, HTMLElement>());
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const steps = useMemo(() => {
    if (liveSteps.length > 0) return liveSteps;

    const raw =
      assessment?.agent_trace ??
      (
        assessment?.metadata as {
          agent_trace?: Array<Record<string, unknown>>;
        } | null
      )?.agent_trace ??
      [];
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return normalizeAgentTrace(raw, assessment);
  }, [liveSteps, assessment]);

  const groups = useMemo(() => groupByAgentCanonical(steps), [steps]);

  const phases = useMemo(() => groupIntoPhases(groups), [groups]);

  const flowNodes = useMemo(
    () =>
      groups.map(({ agent, steps: agentSteps }) => {
        const visible = contentSteps(agentSteps);
        let tone = groupTone(agent, visible);
        if (inProgress && tone === "verdict") tone = "neutral";
        return {
          agent,
          count: visible.length,
          tone,
        };
      }),
    [groups, inProgress],
  );

  const stepCount = contentSteps(steps).length;

  const setGroupRef = useCallback((agent: string, el: HTMLElement | null) => {
    if (el) groupEls.current.set(agent, el);
    else groupEls.current.delete(agent);
  }, []);

  const focusedRef = useRef<string | null>(null);
  const scrollTimers = useRef<number[]>([]);

  const scrollGroupIntoView = useCallback(
    (agent: string, behavior: ScrollBehavior = "smooth") => {
      const el = groupEls.current.get(agent);
      const scroller = listRef.current;
      if (!el || !scroller) return;

      // Measure after focus expand/collapse has painted — sibling height
      // changes shift targets when moving top→bottom.
      const pad = 12;
      const delta =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({
        top: Math.max(0, scroller.scrollTop + delta - pad),
        behavior,
      });
    },
    [],
  );

  const focusAgent = useCallback(
    (agent: string) => {
      const changed = focusedRef.current !== agent;
      focusedRef.current = agent;
      setFocusedAgent(agent);
      if (!changed) return;

      for (const id of scrollTimers.current) window.clearTimeout(id);
      scrollTimers.current = [];

      const schedule = (ms: number, behavior: ScrollBehavior) => {
        const id = window.setTimeout(() => {
          if (focusedRef.current !== agent) return;
          scrollGroupIntoView(agent, behavior);
        }, ms);
        scrollTimers.current.push(id);
      };

      // Paint focus styles first, then correct as layout settles.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollGroupIntoView(agent, "smooth"));
      });
      schedule(80, "auto");
      schedule(220, "auto");
    },
    [scrollGroupIntoView],
  );

  const clearFocus = useCallback(() => {
    focusedRef.current = null;
    setFocusedAgent(null);
    for (const id of scrollTimers.current) window.clearTimeout(id);
    scrollTimers.current = [];
  }, []);

  const onToggle = useCallback((e: SyntheticEvent<HTMLDetailsElement>) => {
    const open = e.currentTarget.open;
    setExpanded(open);
    if (!open) return;
    requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });
  }, []);

  return (
    <details
      ref={rootRef}
      className={styles.root}
      data-in-progress={inProgress ? "true" : undefined}
      aria-label="Agent investigation trace"
      aria-busy={inProgress ? "true" : undefined}
      onToggle={onToggle}
    >
      <summary className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.headerRow}>
            {inProgress ? (
              <span className={styles.liveDot} aria-hidden />
            ) : null}
            <h3 className={styles.title}>Agent trace</h3>
            {inProgress ? (
              <span className={styles.inProgressBadge}>In progress</span>
            ) : null}
            {stepCount > 0 && (
              <span className={styles.count}>{stepCount}</span>
            )}
            <span className={styles.chevron} aria-hidden>
              ⌄
            </span>
          </div>
          <p className={styles.blurb}>
            Step-by-step view of how the system checked sensors, nearby hazards,
            and reached a verdict — from start to finish.
          </p>
        </div>
      </summary>

      {expanded ? (
        steps.length === 0 || groups.length === 0 ? (
          inProgress ? (
            <div className={styles.starting}>
              <span className={styles.startingPulse} aria-hidden />
              <p>Agents are starting — steps will appear here as they run.</p>
            </div>
          ) : (
            <p className={styles.empty}>
              No agent trace recorded for this review yet.
            </p>
          )
        ) : (
          <div className={styles.layout}>
            <div className={styles.detailPane} ref={listRef}>
              <div className={styles.body}>
                {phases.map((phase) => (
                  <div
                    key={phase.id}
                    className={styles.phase}
                    data-phase={phase.id}
                  >
                    <header className={styles.phaseHeader}>
                      <h4 className={styles.phaseTitle}>{phase.title}</h4>
                      <p className={styles.phaseBlurb}>{phase.blurb}</p>
                    </header>
                    <div className={styles.phaseBody}>
                      {phase.groups.map(({ agent, steps: agentSteps }) => (
                        <AgentGroup
                          key={agent}
                          agent={agent}
                          steps={agentSteps}
                          focused={focusedAgent === agent}
                          dimmed={
                            focusedAgent != null && focusedAgent !== agent
                          }
                          groupRef={(el) => setGroupRef(agent, el)}
                          inProgress={inProgress}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <RubberFlowGraph
              nodes={flowNodes}
              focusedAgent={focusedAgent}
              onFocus={focusAgent}
              onClear={clearFocus}
            />
          </div>
        )
      ) : null}
    </details>
  );
}
