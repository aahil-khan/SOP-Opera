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

/**
 * The frozen content of one closure report.
 *
 * Typed rather than `Record<string, unknown>` so the UI never has to defensively
 * `String()`-cast Postgres output into prose. Mirrors `ReportPacket` in
 * `backend/app/reports/packet.py` — the two are hand-kept in sync.
 */
export type PacketSource = "frozen" | "live" | "unavailable";

export interface PacketPerson {
  id?: string | null;
  name: string;
  role?: string | null;
}

export interface PacketAsset {
  id: string;
  name: string;
  zone: string;
  plant_id: string;
  floor: string;
}

export interface PacketMeta {
  packet_version: number;
  report_id: string | null;
  review_id: string;
  closure_event_seq: number;
  version_label: string;
  report_ref: string;
  supersedes_report_id: string | null;
  frozen_at: string | null;
  closed_by: string | null;
  generator: string;
  hash_algorithm: string;
  evidence_id: string | null;
  snapshot_hash: string | null;
  /** frozen_evidence | live_fallback | legacy_v1 | unreadable_v2 */
  built_from: string;
  audit_tail_seq: number | null;
}

export interface PacketHeader {
  title: string;
  asset: PacketAsset;
  review_state: string;
  origin: string | null;
  triggered_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  duration_seconds: number | null;
  owner: PacketPerson | null;
  area_owner: PacketPerson | null;
  raised_by: PacketPerson | null;
  tagged_workers: PacketPerson[];
  supervisor_report: {
    description?: string | null;
    concern_type?: string | null;
  } | null;
  outcome_headline: string;
  risk_headline: string;
}

export interface PacketDisposition {
  recommendation_id: string | null;
  text: string;
  rationale: string | null;
  disposition: string | null;
}

export interface PacketDecision {
  id: string;
  outcome: string;
  outcome_label: string;
  conditions: string | null;
  comments: string | null;
  decided_by: PacketPerson | null;
  submitted_at: string | null;
  assessment_id: string | null;
  time_to_decision_seconds: number | null;
  dispositions: PacketDisposition[];
}

export interface PacketAssessment {
  source: PacketSource;
  id: string | null;
  version: number | null;
  assessment_type: string | null;
  status: string | null;
  risk_level: string | null;
  summary: string | null;
  created_at: string | null;
  provider: string | null;
  model: string | null;
  confidence: number | null;
  retrieval_mode: string | null;
  retrieval_quality: string | null;
  latency_ms: number | null;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  failure_reason: string | null;
}

export interface PacketFact {
  id: string | null;
  fact_type: string;
  label: string;
  value: unknown;
  computed_at: string | null;
  source_context_ids: string[];
}

export interface PacketContextEntry {
  id: string | null;
  category: string;
  category_label: string;
  /** One line of plain English — render this, not the payload. */
  summary_line: string;
  provider: string | null;
  valid_from: string | null;
  valid_until: string | null;
  confidence: number | null;
  payload: Record<string, unknown>;
}

export interface PacketEvidence {
  source: PacketSource;
  note: string | null;
  snapshot_hash: string | null;
  captured_at: string | null;
  entries: PacketContextEntry[];
}

export interface PacketCitation {
  source: string | null;
  id: string | null;
  code: string | null;
  clause: string | null;
  title: string | null;
  snippet: string | null;
  source_url: string | null;
  cited_in_summary: boolean;
}

export interface PacketCitations {
  source: PacketSource;
  references: PacketCitation[];
  cited: string[];
  unsupported: string[];
  ok: boolean;
}

export interface PacketTask {
  id: string;
  task_type: string;
  title: string;
  detail: string | null;
  status: string;
  assigned_worker_name: string | null;
  created_by: string | null;
  created_at: string | null;
  acknowledged_at: string | null;
  done_at: string | null;
  done_note: string | null;
}

export interface PacketTasks {
  source: PacketSource;
  total: number;
  open: number;
  acknowledged: number;
  done: number;
  cancelled: number;
  items: PacketTask[];
}

export interface PacketComment {
  id: string;
  author_kind: string | null;
  author_name: string | null;
  body: string;
  created_at: string | null;
}

export interface PacketAuditEntry {
  seq: number | null;
  recorded_at: string | null;
  entity_type: string | null;
  event_type: string;
  event_label: string;
  actor: string | null;
  prev_hash: string | null;
  entry_hash: string | null;
}

export interface PacketTimelineEvent {
  ts: string | null;
  label: string;
  actor: string | null;
  detail: string | null;
}

export interface ReportPacket {
  meta: PacketMeta;
  header: PacketHeader;
  decision: PacketDecision | null;
  assessment: PacketAssessment | null;
  reasoning_factors: Record<string, unknown>[];
  recommendations: PacketDisposition[];
  facts: PacketFact[];
  evidence: PacketEvidence;
  citations: PacketCitations;
  tasks: PacketTasks;
  discussion: PacketComment[];
  audit_trail: PacketAuditEntry[];
  timeline: PacketTimelineEvent[];
}

/**
 * Whether the packet still is what it was when frozen. Recomputed on every read
 * — an integrity claim frozen at write time proves nothing about the period since.
 */
export interface ReportIntegrity {
  content_hash_stored: string | null;
  content_hash_recomputed: string | null;
  content_hash_status: "match" | "mismatch" | "not_recorded";
  snapshot_hash: string | null;
  chain_intact: boolean;
  chain_entries_checked: number;
  chain_breaks: Record<string, unknown>[];
  verified_at: string | null;
}

export interface ReportVersionRef {
  id: string;
  closure_event_seq: number;
  version_label: string;
  generated_at: string;
  is_current: boolean;
  outcome: string | null;
  content_hash: string | null;
}

export interface Report {
  id: string;
  review_id: string;
  closure_event_seq: number;
  version_label: string;
  is_current: boolean;
  packet_version: number;
  supersedes_report_id: string | null;
  superseded_by_report_id: string | null;
  generated_at: string;
  frozen_at: string | null;
  closed_by: string | null;
  content_hash: string | null;
  content: ReportPacket;
  integrity: ReportIntegrity;
  versions: ReportVersionRef[];
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

/**
 * How the brief prose was produced.
 * - `llm` — live model returned usable text
 * - `deterministic` — AI_PROVIDER=mock; template only, no model contacted
 * - `fallback` — a model is configured, but the call failed/empty so the template ran
 */
export type HandoverNarrationMode = "llm" | "deterministic" | "fallback";

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
