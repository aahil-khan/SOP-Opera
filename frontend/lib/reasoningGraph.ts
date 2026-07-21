import type { DomainId } from "@/lib/domains";
import type {
  AgentStepEvent,
  SpatialLinkView,
} from "@/lib/liveStore";
import type { AssessmentHistoryItem, ReviewDetail } from "@/lib/liveApi";
import type {
  AreaOwner,
  Assessment,
  Asset,
  Context,
  Decision,
  DerivedFact,
  ReasoningFactor,
  RetrievedReference,
} from "@/shared/schemas";

export type ReasoningNodeKind =
  | "asset"
  | "context"
  | "fact"
  | "factor"
  | "reference"
  | "recommendation"
  | "decision"
  | "owner"
  | "spatial_asset"
  | "agent_step"
  | "summary";

/**
 * Fixed pipeline bands the graph renders top-to-bottom, in order.
 * Every node is placed in exactly one band; agent investigation steps
 * each get their own row within the "investigation" band so the
 * chronological trace reads as a straight line.
 */
export const PIPELINE_BANDS = [
  "trigger",
  "signals",
  "facts",
  "investigation",
  "reasoning",
  "evidence",
  "assessment",
  "recommendations",
  "decision",
] as const;

export type PipelineBand = (typeof PIPELINE_BANDS)[number];

export const BAND_LABEL: Record<PipelineBand, string> = {
  trigger: "Trigger",
  signals: "Signals",
  facts: "Derived facts",
  investigation: "Agent investigation",
  reasoning: "Reasoning",
  evidence: "Evidence",
  assessment: "Assessment",
  recommendations: "Recommendations",
  decision: "Decision",
};

export interface ReasoningGraphNode {
  id: string;
  label: string;
  kind: ReasoningNodeKind;
  domain: DomainId | "core";
  detail: string;
  meta?: Record<string, string>;
  weight: number;
  /** Absolute row index — determines vertical position (0 = top). */
  stage: number;
  /** Which pipeline band this row belongs to, for banding/labels. */
  band: PipelineBand;
}

export interface ReasoningGraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface ReasoningGraphData {
  nodes: ReasoningGraphNode[];
  edges: ReasoningGraphEdge[];
}

function ctxSummary(c: Context): string {
  const p = c.payload;
  if (c.category === "sensor" && typeof p.gas_reading === "number") {
    return `Gas ${p.gas_reading}${typeof p.unit === "string" ? ` ${p.unit}` : ""}`;
  }
  if (c.category === "worker_location") {
    const name =
      typeof p.worker_name === "string"
        ? p.worker_name
        : `Worker ${String(p.worker_id ?? "?").slice(0, 8)}`;
    return `${name} in ${String(p.zone ?? "?")}`;
  }
  if (c.category === "permit") {
    const work =
      typeof p.work_type === "string"
        ? ` · ${p.work_type.replaceAll("_", " ")}`
        : "";
    return `Permit ${String(p.permit_id ?? "?")} · ${String(p.status ?? "")}${work}`;
  }
  return c.category;
}

function domainForContext(c: Context): DomainId {
  if (c.category === "sensor") return "sensors";
  if (c.category === "permit") return "permits";
  if (c.category === "worker_location" || c.category === "certification") {
    return "people";
  }
  return "evidence";
}

function domainForAgent(agent: string): DomainId | "core" {
  if (agent === "scada" || agent === "sim_scada") return "sensors";
  if (agent === "permit" || agent === "sim_ptw") return "permits";
  if (agent === "workforce" || agent === "sim_workforce") return "people";
  if (agent === "spatial") return "spatial";
  if (agent === "incident_pattern" || agent === "maintenance") return "evidence";
  return "core";
}

function refLabel(r: RetrievedReference): string {
  if (r.code && r.title) return `${r.code}: ${r.title}`;
  if (r.title) return r.title;
  return r.source.replaceAll("_", " ");
}

function matchHint(r: RetrievedReference): string {
  if (r.retrieval_path === "rag" && r.score != null) {
    return `RAG · ${r.score.toFixed(2)}`;
  }
  if (r.triggered_by_fact) {
    return `matched · ${r.triggered_by_fact.replaceAll("_", " ")}`;
  }
  return "matched by category";
}

function agentLabel(agent: string): string {
  const map: Record<string, string> = {
    scada: "SCADA",
    permit: "Permit",
    maintenance: "Maintenance",
    workforce: "Workforce",
    spatial: "Spatial",
    incident_pattern: "Incident",
    shift_handover: "Handover",
    orchestrator: "Orchestrator",
  };
  return map[agent] ?? agent;
}

/** Normalize persisted assessment.agent_trace JSON into AgentStepEvent[]. */
export function normalizeAgentTrace(
  trace: Array<Record<string, unknown>>,
  assessment: Assessment | AssessmentHistoryItem | null,
): AgentStepEvent[] {
  if (!Array.isArray(trace) || trace.length === 0) return [];
  return trace.map((raw, i) => ({
    id: String(raw.id ?? `trace-${i}`),
    agent: String(raw.agent ?? "orchestrator"),
    kind: (raw.kind as AgentStepEvent["kind"]) ?? "observation",
    message: String(raw.message ?? ""),
    review_id:
      typeof raw.review_id === "string"
        ? raw.review_id
        : assessment?.review_id ?? null,
    assessment_id:
      typeof raw.assessment_id === "string"
        ? raw.assessment_id
        : assessment?.id ?? null,
    finding: (raw.finding as AgentStepEvent["finding"]) ?? "neutral",
    detail:
      raw.detail && typeof raw.detail === "object"
        ? (raw.detail as Record<string, unknown>)
        : {},
    ts: String(raw.ts ?? new Date().toISOString()),
  }));
}

/** @deprecated Use normalizeAgentTrace */
const normalizeTraceSteps = normalizeAgentTrace;

export interface BuildReasoningGraphInput {
  asset: Asset;
  context: Context[];
  derivedFacts: DerivedFact[];
  references: RetrievedReference[];
  assessment: Assessment | AssessmentHistoryItem | null;
  decision: Decision | null;
  areaOwner?: AreaOwner | null;
  spatialLinks?: SpatialLinkView[];
  agentSteps?: AgentStepEvent[];
  agentTrace?: Array<Record<string, unknown>>;
}

export function buildReasoningGraph(
  input: BuildReasoningGraphInput,
): ReasoningGraphData {
  const {
    asset,
    context,
    derivedFacts,
    references,
    assessment,
    decision,
    areaOwner = null,
    spatialLinks = [],
    agentSteps = [],
  } = input;

  const nodes: ReasoningGraphNode[] = [];
  const edges: ReasoningGraphEdge[] = [];
  const seen = new Set<string>();

  const addNode = (n: ReasoningGraphNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };
  const addEdge = (source: string, target: string, relation: string) => {
    if (!seen.has(source) || !seen.has(target)) return;
    edges.push({ source, target, relation });
  };

  // Pre-compute the investigation step list so downstream bands know how
  // many rows the investigation band consumes — this is what makes the
  // pipeline rigid: every band has a fixed, predictable row range.
  const steps = (
    agentSteps.length > 0
      ? agentSteps
      : normalizeTraceSteps(input.agentTrace ?? [], assessment)
  ).filter((s) => s.kind !== "started" && s.kind !== "completed");

  const STAGE_TRIGGER = 0;
  const STAGE_SIGNALS = 1;
  const STAGE_FACTS = 2;
  const STAGE_INVESTIGATION_START = 3;
  const STAGE_REASONING = STAGE_INVESTIGATION_START + Math.max(steps.length, 1);
  const STAGE_EVIDENCE = STAGE_REASONING + 1;
  const STAGE_ASSESSMENT = STAGE_EVIDENCE + 1;
  const STAGE_RECOMMENDATIONS = STAGE_ASSESSMENT + 1;
  const STAGE_DECISION = STAGE_RECOMMENDATIONS + 1;

  const assetId = `asset:${asset.id}`;
  addNode({
    id: assetId,
    label: asset.name,
    kind: "asset",
    domain: "core",
    detail: `Zone ${asset.zone}`,
    weight: 14,
    stage: STAGE_TRIGGER,
    band: "trigger",
  });

  if (areaOwner) {
    const oid = `owner:${areaOwner.name}`;
    addNode({
      id: oid,
      label: areaOwner.name,
      kind: "owner",
      domain: "people",
      detail: `${areaOwner.role} · ${areaOwner.zone}`,
      weight: 8,
      stage: STAGE_SIGNALS,
      band: "signals",
    });
    addEdge(assetId, oid, "owned_by");
  }

  for (const c of context) {
    const id = `ctx:${c.id}`;
    addNode({
      id,
      label: ctxSummary(c),
      kind: "context",
      domain: domainForContext(c),
      detail: c.category,
      weight: 6,
      stage: STAGE_SIGNALS,
      band: "signals",
    });
    addEdge(assetId, id, "has_context");
  }

  for (const L of spatialLinks) {
    const otherId =
      L.from_asset_id === asset.id ? L.to_asset_id : L.from_asset_id;
    const otherLabel =
      L.from_asset_id === asset.id ? L.to_label : L.from_label;
    const nid = `spatial:${otherId}`;
    addNode({
      id: nid,
      label: otherLabel || otherId.slice(0, 8),
      kind: "spatial_asset",
      domain: "spatial",
      detail: `${L.relation} · ${L.distance_m.toFixed(1)}m${L.reason ? ` — ${L.reason}` : ""}`,
      weight: 7,
      stage: STAGE_SIGNALS,
      band: "signals",
    });
    addEdge(assetId, nid, L.relation);
  }

  for (const f of derivedFacts) {
    const id = `fact:${f.id}`;
    addNode({
      id,
      label: String(f.fact_type).replaceAll("_", " "),
      kind: "fact",
      domain: "evidence",
      detail: typeof f.value === "string" ? f.value : JSON.stringify(f.value),
      weight: 8,
      stage: STAGE_FACTS,
      band: "facts",
    });
    addEdge(assetId, id, "derived");
  }

  let prevAgentNode: string | null = null;
  steps.forEach((step, i) => {
    const id = `agent:${step.id}`;
    addNode({
      id,
      label: `${agentLabel(step.agent)} · ${step.kind}`,
      kind: "agent_step",
      domain: domainForAgent(step.agent),
      detail: step.message,
      meta: {
        finding: step.finding,
        agent: step.agent,
        kind: step.kind,
      },
      weight: step.kind === "verdict" ? 10 : 5,
      stage: STAGE_INVESTIGATION_START + i,
      band: "investigation",
    });
    if (prevAgentNode) {
      addEdge(prevAgentNode, id, "then");
    } else {
      addEdge(assetId, id, "investigated");
    }
    prevAgentNode = id;
  });

  const factors: ReasoningFactor[] =
    assessment?.reasoning_factors ??
    (assessment as Assessment | null)?.metadata?.reasoning_factors ??
    [];

  for (const factor of factors) {
    const id = `factor:${factor.fact_type}`;
    addNode({
      id,
      label: factor.headline,
      kind: "factor",
      domain: "evidence",
      detail: factor.detail,
      weight: 9,
      stage: STAGE_REASONING,
      band: "reasoning",
    });
    const matchingFact = derivedFacts.find(
      (f) => String(f.fact_type) === factor.fact_type,
    );
    if (matchingFact) {
      addEdge(`fact:${matchingFact.id}`, id, "explains");
    } else if (prevAgentNode) {
      addEdge(prevAgentNode, id, "factor");
    } else {
      addEdge(assetId, id, "factor");
    }
  }

  for (const r of references) {
    const id = `ref:${r.source}:${r.id}`;
    addNode({
      id,
      label: refLabel(r),
      kind: "reference",
      domain: "evidence",
      detail: r.snippet ?? matchHint(r),
      meta: {
        path: r.retrieval_path,
        source: r.source,
      },
      weight: 7,
      stage: STAGE_EVIDENCE,
      band: "evidence",
    });
    if (r.triggered_by_fact) {
      const fact = derivedFacts.find(
        (f) => String(f.fact_type) === r.triggered_by_fact,
      );
      if (fact) {
        addEdge(`fact:${fact.id}`, id, "matched");
      } else {
        addEdge(assetId, id, "retrieved");
      }
    } else {
      addEdge(assetId, id, "retrieved");
    }
  }

  let summaryId: string | null = null;
  if (assessment?.summary) {
    summaryId = `summary:${assessment.id}`;
    addNode({
      id: summaryId,
      label: "Assessment",
      kind: "summary",
      domain: "core",
      detail: assessment.summary,
      meta: {
        risk: String(
          (assessment as Assessment).risk_level ??
            (assessment as AssessmentHistoryItem).risk_level ??
            "",
        ),
      },
      weight: 12,
      stage: STAGE_ASSESSMENT,
      band: "assessment",
    });
    if (factors.length > 0) {
      for (const factor of factors) {
        addEdge(`factor:${factor.fact_type}`, summaryId, "supports");
      }
    } else {
      addEdge(assetId, summaryId, "assessed");
    }
  }

  const recs = assessment?.recommendations ?? [];
  for (const rec of recs) {
    const id = `rec:${rec.id}`;
    addNode({
      id,
      label: rec.text.slice(0, 60) + (rec.text.length > 60 ? "…" : ""),
      kind: "recommendation",
      domain: "core",
      detail: rec.rationale ?? rec.text,
      weight: 8,
      stage: STAGE_RECOMMENDATIONS,
      band: "recommendations",
    });
    if (summaryId) {
      addEdge(summaryId, id, "recommends");
    } else {
      addEdge(assetId, id, "recommends");
    }
  }

  if (decision) {
    const did = `decision:${decision.id ?? "outcome"}`;
    const detailParts = [
      decision.conditions ? `Conditions: ${decision.conditions}` : null,
      decision.comments ? `Comments: ${decision.comments}` : null,
    ].filter(Boolean);
    addNode({
      id: did,
      label: decision.outcome.replaceAll("_", " "),
      kind: "decision",
      domain: "core",
      detail: detailParts.length > 0 ? detailParts.join("\n") : "No conditions or comments",
      weight: 11,
      stage: STAGE_DECISION,
      band: "decision",
    });
    if (recs.length > 0) {
      for (const rec of recs) {
        addEdge(`rec:${rec.id}`, did, "acted_on");
      }
    } else if (summaryId) {
      addEdge(summaryId, did, "decided");
    } else {
      addEdge(assetId, did, "decided");
    }
  }

  return { nodes, edges };
}

/** Convenience builder from a ReviewDetail + assessment history item. */
export function buildReasoningGraphFromDetail(
  detail: ReviewDetail,
  assessment: AssessmentHistoryItem | null,
  spatialLinks: SpatialLinkView[] = [],
  agentSteps: AgentStepEvent[] = [],
): ReasoningGraphData {
  const factors =
    assessment?.reasoning_factors ??
    assessment?.metadata?.reasoning_factors ??
    [];
  const agentTrace =
    (assessment as AssessmentHistoryItem & { agent_trace?: unknown[] })
      ?.agent_trace ??
    (assessment?.metadata as { agent_trace?: unknown[] } | null)?.agent_trace ??
    [];

  return buildReasoningGraph({
    asset: detail.asset,
    context: detail.context,
    derivedFacts: detail.derived_facts,
    references: assessment?.retrieved_references ?? [],
    assessment: assessment
      ? {
          id: assessment.id,
          review_id: assessment.review_id,
          assessment_type: assessment.assessment_type,
          status: assessment.status,
          risk_level: (assessment.risk_level ?? "elevated") as
            | "nominal"
            | "elevated"
            | "blocking",
          summary: assessment.summary ?? "",
          recommendations: assessment.recommendations,
          derived_fact_ids: assessment.derived_fact_ids,
          reasoning_factors: factors,
          metadata: assessment.metadata
            ? {
                provider: assessment.metadata.provider,
                model: assessment.metadata.model ?? "",
                prompt_version: assessment.metadata.prompt_version ?? "",
                input_tokens: assessment.metadata.input_tokens ?? 0,
                output_tokens: assessment.metadata.output_tokens ?? 0,
                estimated_cost_usd:
                  assessment.metadata.estimated_cost_usd ?? 0,
                latency_ms: assessment.metadata.latency_ms ?? 0,
                timestamp:
                  assessment.created_at ?? new Date().toISOString(),
                retrieved_context_ids:
                  assessment.metadata.retrieved_context_ids ?? [],
                retrieved_evidence_ids:
                  assessment.metadata.retrieved_evidence_ids ?? [],
                retrieval_mode:
                  assessment.metadata.retrieval_mode ?? "skipped",
                retrieval_quality:
                  assessment.metadata.retrieval_quality ?? "n_a",
                retrieval_score: assessment.metadata.retrieval_score ?? null,
                embedding_model: assessment.metadata.embedding_model ?? null,
                confidence: assessment.metadata.confidence ?? 0,
                assessment_version:
                  assessment.metadata.assessment_version ?? assessment.version,
                reasoning_factors: factors,
              }
            : null,
        }
      : null,
    decision: detail.decision,
    areaOwner: detail.area_owner,
    spatialLinks,
    agentSteps,
    agentTrace: Array.isArray(agentTrace)
      ? (agentTrace as Array<Record<string, unknown>>)
      : [],
  });
}
