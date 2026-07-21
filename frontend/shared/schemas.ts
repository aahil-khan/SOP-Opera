/** Canonical domain schemas — frozen in Phase 0 (TDS §8). */

import type {
  AssessmentStatus,
  AssessmentType,
  DecisionOutcome,
  FactType,
  RecommendationDisposition,
  ReferenceSource,
  RetrievalMode,
  RetrievalPath,
  RetrievalQuality,
  ReviewState,
  RiskLevel,
} from "./enums";

export interface Context {
  id: string;
  asset_id: string;
  category: string;
  payload: Record<string, unknown>;
  provider: string;
  valid_from: string;
  valid_until: string;
  confidence: number;
}

export interface DerivedFact {
  id: string;
  asset_id: string;
  fact_type: FactType | string;
  value: boolean | number | string;
  computed_at: string;
  source_context_ids: string[];
}

export interface RetrievedReference {
  source: ReferenceSource;
  id: string;
  retrieval_path: RetrievalPath;
  score: number | null;
  chunk_id: string | null;
  title?: string | null;
  snippet?: string | null;
  code?: string | null;
  triggered_by_fact?: string | null;
  /** Primary-source link, so a cited clause can be checked rather than trusted. */
  source_url?: string | null;
}

export interface ReasoningFactor {
  fact_type: string;
  headline: string;
  detail: string;
  evidence: RetrievedReference[];
  context_ids: string[];
}

export interface AreaOwner {
  worker_id: string;
  name: string;
  role: string;
  zone: string;
}

export interface Recommendation {
  id: string;
  text: string;
  rationale: string;
  disposition: RecommendationDisposition | null;
}

export interface RecommendationIn {
  text: string;
  rationale: string;
}

export interface ManualAssessmentIn {
  summary: string;
  risk_level: RiskLevel;
  recommendations: RecommendationIn[];
}

export interface AssessmentMetadata {
  provider: string;
  model: string;
  prompt_version: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number;
  timestamp: string;
  retrieved_context_ids: string[];
  retrieved_evidence_ids: string[];
  retrieval_mode: RetrievalMode;
  retrieval_quality: RetrievalQuality;
  retrieval_score: number | null;
  embedding_model: string | null;
  confidence: number;
  assessment_version: number;
  reasoning_factors?: ReasoningFactor[];
}

export interface Assessment {
  id: string;
  review_id: string;
  assessment_type: AssessmentType;
  status: AssessmentStatus;
  risk_level: RiskLevel;
  summary: string;
  recommendations: Recommendation[];
  derived_fact_ids: string[];
  metadata: AssessmentMetadata | null;
  reasoning_factors?: ReasoningFactor[];
}

export interface Decision {
  id: string;
  review_id: string;
  assessment_id: string;
  decided_by: string;
  outcome: DecisionOutcome;
  recommendation_dispositions: Record<string, "accepted" | "rejected">;
  conditions: string | null;
  comments: string | null;
  submitted_at: string;
}

export interface Review {
  id: string;
  asset_id: string;
  state: ReviewState;
  owner_id: string;
  triggered_by: string;
  origin: "system" | "operator" | "supervisor";
  raised_by_worker_id: string | null;
  created_at: string;
}

export interface Asset {
  id: string;
  name: string;
  zone: string;
  plant_id: string;
  floor: "ground" | "first" | "second";
}

export interface Report {
  id: string;
  review_id: string;
  closure_event_seq: number;
  content: Record<string, unknown>;
  generated_at: string;
}

export interface Notification {
  id: string;
  review_id: string | null;
  event_type: string;
  summary: string;
  recipient_ids: string[];
  created_at: string;
}

/**
 * Shift handover — a custody transfer between panel operators.
 *
 * A handover is `draft` while the outgoing operator edits it, `issued` once
 * handed to the incoming operator, and `accepted` only after every item marked
 * `requires_ack` has been acknowledged or queried. `expired` marks one that was
 * superseded before it was accepted — its pending items are the gaps.
 */
export type HandoverState = "draft" | "issued" | "accepted" | "expired";

export type HandoverItemType =
  | "open_review"
  | "active_fact"
  | "open_task"
  | "decision_condition"
  | "note";

export type HandoverAckState = "pending" | "acknowledged" | "queried";

/** Whether the brief prose came from a model or the deterministic template. */
export type HandoverNarrationMode = "llm" | "deterministic";

export interface HandoverItem {
  id: string;
  item_type: HandoverItemType;
  position: number;
  review_id: string | null;
  asset_id: string | null;
  asset_name: string | null;
  task_id: string | null;
  title: string;
  detail: string | null;
  risk_level: string;
  hazard_dimensions: string[];
  requires_ack: boolean;
  ack_state: HandoverAckState;
  ack_note: string | null;
  acknowledged_by: string | null;
  acknowledged_by_name: string | null;
  acknowledged_at: string | null;
  source: "auto" | "manual";
}

export interface Handover {
  id: string;
  state: HandoverState;
  outgoing_actor_id: string;
  outgoing_actor_name: string;
  incoming_actor_id: string;
  incoming_actor_name: string;
  window_start: string;
  window_end: string;
  brief: string | null;
  narration_mode: HandoverNarrationMode;
  issued_at: string | null;
  accepted_at: string | null;
  created_at: string;
  items: HandoverItem[];
  required_total: number;
  required_cleared: number;
  attention_asset_id: string | null;
  /** Which side of this handover the requester is on; supervisors are observers. */
  viewer_role: "outgoing" | "incoming" | "observer";
}

export interface HandoverGap {
  handover_id: string;
  item_id: string;
  asset_id: string | null;
  asset_name: string | null;
  title: string;
  risk_level: string;
  incoming_actor_name: string;
  issued_at: string | null;
  hours_outstanding: number;
}

export interface HandoverMetrics {
  handovers_total: number;
  handovers_accepted: number;
  required_items_total: number;
  required_items_cleared: number;
  coverage_pct: number;
  median_ack_minutes: number | null;
  unacknowledged_crossings: number;
}
