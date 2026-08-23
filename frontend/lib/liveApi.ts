/**
 * Live FastAPI client for Phase 4+ — typed against shared contracts.
 */

import type {
  AreaOwner,
  Assessment,
  Asset,
  Context,
  Decision,
  DerivedFact,
  Handover,
  HandoverAckState,
  HandoverGap,
  HandoverMetrics,
  ManualAssessmentIn,
  Notification,
  ReasoningFactor,
  Report,
  RetrievedReference,
  Review,
} from "@/shared/schemas";
import type { DecisionOutcome, RiskLevel } from "@/shared/enums";
import { actorRequestHeaders } from "@/lib/actorCookie";
import { API_BASE } from "@/lib/api";
import type { ThresholdsConfig } from "@/lib/sensorThresholds";

export interface ReviewDetail {
  review: Review;
  asset: Asset;
  context: Context[];
  derived_facts: DerivedFact[];
  decision: Decision | null;
  decided_by_name?: string | null;
  area_owner?: AreaOwner | null;
  raised_by_worker_name?: string | null;
  supervisor_report?: {
    description: string;
    concern_type: string;
    reported_by_name: string;
  } | null;
  task_summary?: TaskSummary | null;
  tasks?: ReviewTaskBrief[];
}

export interface ReviewTaskBrief {
  id: string;
  assigned_worker_id: string;
  assigned_worker_name: string | null;
  task_type: "follow_up" | "unblock";
  title: string;
  detail: string | null;
  status: "open" | "acknowledged" | "done" | "cancelled";
  created_at: string;
  acknowledged_at: string | null;
  done_at: string | null;
  done_note: string | null;
}

export interface TaskSummary {
  total: number;
  open: number;
  acknowledged: number;
  done: number;
  cancelled: number;
  all_done: boolean;
}

export interface AssessmentHistoryItem extends Omit<Assessment, "risk_level" | "summary"> {
  risk_level: RiskLevel | null;
  summary: string | null;
  version: number;
  created_at: string | null;
  retrieved_references: RetrievedReference[];
  reasoning_factors?: ReasoningFactor[];
  agent_trace?: Array<Record<string, unknown>>;
  metadata: Assessment["metadata"] & {
    input_tokens?: number;
    output_tokens?: number;
    estimated_cost_usd?: number;
    assessment_version?: number;
    reasoning_factors?: ReasoningFactor[];
    agent_trace?: Array<Record<string, unknown>>;
  } | null;
}

export interface DecisionIn {
  outcome: DecisionOutcome;
  recommendation_dispositions: Record<string, "accepted" | "rejected">;
  conditions: string | null;
  comments?: string | null;
  tagged_worker_ids: string[];
}

export interface ReviewTask {
  id: string;
  review_id: string;
  decision_id: string | null;
  assigned_worker_id: string;
  task_type: "follow_up" | "unblock";
  title: string;
  detail: string | null;
  status: "open" | "acknowledged" | "done" | "cancelled";
  created_by: string;
  created_at: string;
  acknowledged_at: string | null;
  done_at: string | null;
  done_note: string | null;
  review_state: string;
  asset_id: string;
  asset_name: string;
  asset_zone: string;
  asset_floor: string;
  decision_outcome: string | null;
  decision_conditions: string | null;
  decision_comments: string | null;
  decision_submitted_at: string | null;
  decision_decided_by_name: string | null;
}

export interface TaskAcknowledgeOut {
  id: string;
  status: "open" | "acknowledged" | "done" | "cancelled";
  acknowledged_at: string;
}

export interface TaskDoneOut {
  id: string;
  status: "open" | "acknowledged" | "done" | "cancelled";
  done_at: string;
  done_note: string | null;
}

export interface ReviewComment {
  id: string;
  review_id: string;
  author_kind: "user" | "worker";
  author_id: string;
  author_name: string;
  body: string;
  mentioned_worker_ids: string[];
  created_at: string;
}

/** One row of the /reports register. Mirrors `ReportSummaryOut`. */
export interface ReportSummary {
  id: string;
  review_id: string;
  closure_event_seq: number;
  version_label: string;
  report_ref: string;
  is_current: boolean;
  packet_version: number;
  generated_at: string;
  frozen_at: string | null;
  closed_by: string | null;
  title: string | null;
  asset_name: string | null;
  asset_zone: string | null;
  outcome: string | null;
  outcome_label: string | null;
  outcome_headline: string | null;
  summary_line: string | null;
  risk_level: string | null;
  decided_by_name: string | null;
  open_tasks: number;
  citation_count: number;
  evidence_count: number;
  content_hash: string | null;
}

export interface AiOpsSummary {
  data_source: "local_db";
  persists_across_demo_reset: boolean;
  total_assessments: number;
  complete_count: number;
  failed_count: number;
  success_rate: number;
  validation_failure_count: number;
  provider_error_count: number;
  // Assessment health (LLM fell back to a template). Distinct from
  // degraded_channel_count below, which is sensor coverage.
  llm_degraded_count: number;
  llm_fallback_count: number;
  llm_attempt_count: number;
  llm_fallback_rate: number;
  llm_degraded_rate: number;
  rag_hit_rate: number;
  rag_fallback_rate: number;
  mean_retrieval_relevance: number | null;
  retrieval_ran_count: number;
  mean_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  latency_sample_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  mean_cost_usd: number | null;
  langsmith_enabled: boolean;
  langsmith_project: string;
  langsmith_url: string | null;
  blind_channel_count: number;
  degraded_channel_count: number;
  asset_count: number;
  last_retrieval_mode: string | null;
  last_retrieval_quality: string | null;
  last_retrieval_score: number | null;
  last_retrieval_embedding_model: string | null;
  rag_gate_threshold: number | null;
  providers: ProviderComparisonRow[];
}

export interface ProviderConnection {
  provider: string;
  model: string | null;
  ok: boolean;
  status: string;
  reason: string | null;
}

export interface CostProjectionPoint {
  months: number;
  days: number;
  projected_usd: number;
}

export interface CostProjection {
  provider: string;
  /** False for mock/ollama — no per-token pricing, so projections are always $0. */
  is_paid_provider: boolean;
  trailing_window_days: number;
  trailing_cost_usd: number;
  daily_rate_usd: number;
  projections: CostProjectionPoint[];
}

export interface ProviderComparisonRow {
  provider: string;
  model: string | null;
  status: "measured" | "not_run" | "unavailable" | string;
  connection_status: string;
  connection_ok: boolean;
  note: string | null;
  assessment_count: number;
  complete_count: number;
  failed_count: number;
  mean_latency_ms: number | null;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  total_tokens: number | null;
  mean_tokens: number | null;
  total_cost_usd: number | null;
  mean_cost_usd: number | null;
  failure_rate: number | null;
}

/**
 * Carries the HTTP status so a caller can tell a benign conflict from a real
 * failure. The message is byte-identical to what was thrown before, so anything
 * that only formats the error is unaffected.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...actorRequestHeaders(),
      ...(init?.headers ?? {}),
    },
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* ignore */
    }
    throw new ApiError(
      `${init?.method ?? "GET"} ${path} failed (${res.status}): ${detail}`,
      res.status,
      path,
    );
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function fetchAssets(): Promise<Asset[]> {
  return request<Asset[]>("/assets");
}

export interface TelemetrySampleDto {
  source: string;
  asset_id: string;
  asset_name?: string | null;
  category: string;
  payload: Record<string, unknown>;
  ts: string;
  mode?: string;
}

/** Soft ambient ring from DB — hydrates charts before live WS catches up. */
export function fetchRecentTelemetry(params?: {
  per_asset?: number;
  asset_id?: string;
}): Promise<{ samples: TelemetrySampleDto[]; count: number }> {
  const qs = new URLSearchParams();
  if (params?.per_asset != null) qs.set("per_asset", String(params.per_asset));
  if (params?.asset_id) qs.set("asset_id", params.asset_id);
  const suffix = qs.toString() ? `?${qs}` : "";
  return request(`/demo/telemetry/recent${suffix}`);
}

export function fetchReviews(params?: {
  state?: string;
  asset_id?: string;
}): Promise<Review[]> {
  const qs = new URLSearchParams();
  if (params?.state) qs.set("state", params.state);
  if (params?.asset_id) qs.set("asset_id", params.asset_id);
  const suffix = qs.toString() ? `?${qs}` : "";
  return request<Review[]>(`/reviews${suffix}`);
}

export function fetchReviewDetail(id: string): Promise<ReviewDetail> {
  return request<ReviewDetail>(`/reviews/${id}`);
}

export function fetchReviewComments(
  reviewId: string,
): Promise<ReviewComment[]> {
  return request<ReviewComment[]>(`/reviews/${reviewId}/comments`);
}

export function postReviewComment(
  reviewId: string,
  body: { body: string; mentioned_worker_ids: string[] },
): Promise<ReviewComment> {
  return request<ReviewComment>(`/reviews/${reviewId}/comments`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchReviewAssessments(
  id: string,
): Promise<AssessmentHistoryItem[]> {
  return request<AssessmentHistoryItem[]>(`/reviews/${id}/assessments`);
}

export function postDecision(
  reviewId: string,
  body: DecisionIn,
): Promise<Decision> {
  return request<Decision>(`/reviews/${reviewId}/decisions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postCloseReview(reviewId: string): Promise<Review> {
  return request<Review>(`/reviews/${reviewId}/close`, { method: "POST" });
}

export function postReopenReview(
  reviewId: string,
  reason = "",
): Promise<Review> {
  return request<Review>(`/reviews/${reviewId}/reopen`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function postRetryAssessment(
  reviewId: string,
  provider?: "openai_compatible" | "ollama" | "mock" | null,
): Promise<{ assessment_id: string; status: string }> {
  return request(`/reviews/${reviewId}/assessments/retry`, {
    method: "POST",
    body: JSON.stringify(provider ? { provider } : {}),
  });
}

export function postManualAssessment(
  reviewId: string,
  body: ManualAssessmentIn,
): Promise<Assessment> {
  return request<Assessment>(`/reviews/${reviewId}/assessments/manual`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface ReportListParams {
  review_id?: string;
  asset_id?: string;
  outcome?: string;
  risk_level?: string;
  include_superseded?: boolean;
  limit?: number;
  offset?: number;
}

export function fetchReports(
  params?: ReportListParams,
): Promise<ReportSummary[]> {
  const qs = new URLSearchParams();
  if (params?.review_id) qs.set("review_id", params.review_id);
  if (params?.asset_id) qs.set("asset_id", params.asset_id);
  if (params?.outcome) qs.set("outcome", params.outcome);
  if (params?.risk_level) qs.set("risk_level", params.risk_level);
  if (params?.include_superseded) qs.set("include_superseded", "true");
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs}` : "";
  return request<ReportSummary[]>(`/reports${suffix}`);
}

/* Export links must hit FastAPI directly — Next does not proxy /reports. */

export function reportPdfUrl(id: string): string {
  return `${API_BASE}/reports/${id}/export.pdf`;
}

export function reportXlsxUrl(id: string): string {
  return `${API_BASE}/reports/${id}/export.xlsx`;
}

export function reportsDatasetXlsxUrl(includeSuperseded = false): string {
  return `${API_BASE}/reports/export.xlsx${
    includeSuperseded ? "?include_superseded=true" : ""
  }`;
}

export function fetchReport(id: string): Promise<Report> {
  return request<Report>(`/reports/${id}`);
}

export function fetchReviewReports(reviewId: string): Promise<Report[]> {
  return request<Report[]>(`/reviews/${reviewId}/reports`);
}

export function fetchNotifications(limit = 50): Promise<Notification[]> {
  return request<Notification[]>(`/notifications?limit=${limit}`);
}

export function fetchTasks(assignedWorkerId: string): Promise<ReviewTask[]> {
  const qs = new URLSearchParams();
  qs.set("assigned_worker_id", assignedWorkerId);
  return request<ReviewTask[]>(`/tasks?${qs.toString()}`);
}

export function postAcknowledgeTask(
  taskId: string,
): Promise<TaskAcknowledgeOut> {
  return request<TaskAcknowledgeOut>(`/tasks/${taskId}/acknowledge`, {
    method: "POST",
  });
}

export function postDoneTask(
  taskId: string,
  body: { done_note: string },
): Promise<TaskDoneOut> {
  return request<TaskDoneOut>(`/tasks/${taskId}/done`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export interface SupervisorReportIn {
  asset_id: string;
  triggered_by?: string;
  owner_id?: string | null;
  description: string;
  concern_type: string;
  raised_by_worker_id: string;
  tagged_worker_ids?: string[];
}

export interface SharedReview {
  review_id: string;
  asset_id: string;
  asset_name: string;
  asset_zone: string;
  review_state: string;
  description: string;
  concern_type: string;
  raised_by_name: string;
  created_at: string;
  origin?: string;
  source?: "raised" | "shared" | "zone";
}

export function fetchRaisedReviews(): Promise<SharedReview[]> {
  return request<SharedReview[]>("/reviews/raised-by-me");
}

export function fetchSharedReviews(): Promise<SharedReview[]> {
  return request<SharedReview[]>("/reviews/shared-with-me");
}

export function fetchZoneReviews(): Promise<SharedReview[]> {
  return request<SharedReview[]>("/reviews/in-my-zones");
}

export function postSupervisorReport(
  body: SupervisorReportIn,
): Promise<Review> {
  return request<Review>(`/reviews`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchAssetOwner(assetId: string): Promise<AreaOwner | null> {
  return request<AreaOwner | null>(`/assets/${assetId}/owner`);
}

export function fetchThresholds(): Promise<ThresholdsConfig> {
  return request<ThresholdsConfig>("/api/config/thresholds");
}

export interface AssetCoverage {
  asset_id: string;
  coverage: "assessed" | "degraded" | "blind";
  last_sensor_seen: string | null;
  seconds_since_sensor: number | null;
  reason: string;
}

export function fetchAssetsCoverage(): Promise<AssetCoverage[]> {
  return request<AssetCoverage[]>("/assets/coverage");
}

export interface ThresholdsConfigPatch {
  sensors?: Partial<
    Record<string, { elevated?: number; critical?: number }>
  >;
  rules?: Partial<{
    vibration_anomaly_threshold: number;
    effluent_ph_min: number;
    effluent_ph_max: number;
    tank_level_high_pct: number;
    tank_level_low_pct: number;
    weather_wind_hold_ms: number;
    cert_expiry_warning_days: number;
  }>;
  // W3a coverage knobs — the ThresholdEditor sends these, so the patch type
  // has to describe them or the contract drifts silently.
  coverage?: Partial<{
    sensor_stale_after_seconds: number;
    sensor_confidence_floor: number;
  }>;
}

export function putThresholds(
  body: ThresholdsConfigPatch,
): Promise<ThresholdsConfig> {
  return request<ThresholdsConfig>("/api/config/thresholds", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function fetchAiOpsSummary(): Promise<AiOpsSummary> {
  return request<AiOpsSummary>("/ai-ops/summary");
}

export function fetchCostProjection(): Promise<CostProjection> {
  return request<CostProjection>("/ai-ops/cost-projection");
}

export interface ProviderState {
  active_provider: string;
  active_model: string | null;
  source: "runtime_override" | "env_default" | "auto_default";
  env_default: string;
  configured_default: string | null;
  connection: ProviderConnection;
  fallback_reason: string | null;
  available: string[];
  scope: string;
}

export function fetchProviderState(): Promise<ProviderState> {
  return request<ProviderState>("/ai-ops/provider");
}

export function putProviderState(
  provider: string | null,
): Promise<ProviderState> {
  return request<ProviderState>("/ai-ops/provider", {
    method: "PUT",
    body: JSON.stringify({ provider }),
  });
}

export function testProviderConnection(
  provider: string | null,
): Promise<ProviderConnection> {
  return request<ProviderConnection>("/ai-ops/provider/test", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

export interface AiOpsEvent {
  assessment_id: string;
  review_id: string;
  status: string;
  provider: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  retrieval_mode: string | null;
  retrieval_score: number | null;
  failure_reason: string | null;
  degraded: boolean;
  recorded_at: string;
}

export function fetchAiOpsEvents(limit = 20): Promise<AiOpsEvent[]> {
  return request<AiOpsEvent[]>(`/ai-ops/events?limit=${limit}`);
}

export interface DetectorSummary {
  name: string;
  accuracy: number;
  recall: number;
  false_negative_rate: number;
  precision: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface EvalSummary {
  fn_reduction_pct: number;
  hero_case_id: string;
  // Plant process time, not simulator playback pacing.
  hero_lead_time_minutes: number | null;
  hero_t_forecast_minutes: number | null;
  hero_t_compound_minutes: number | null;
  hero_t_single_sensor_minutes: number | null;
  /** Cases where a statutory stop-work provision applies. */
  positive_count?: number;
  /** What the ground-truth labels are derived from. */
  label_basis?: string;
  single_sensor: DetectorSummary;
  forecast: DetectorSummary;
  compound: DetectorSummary;
  case_count: number;
  compound_only_catch_count: number;
  // Regulatory compliance coverage.
  regulation_coverage_pct?: number;
  statutory_coverage_pct?: number;
  coverage_by_standard?: Record<string, number>;
  // Lead time as a distribution across every scripted scenario.
  lead_times: ScenarioLeadTime[];
  lead_time_min_minutes: number | null;
  lead_time_median_minutes: number | null;
  lead_time_max_minutes: number | null;
  lead_time_defined_count: number;
  // Per-dimension recall contribution.
  ablation: AblationRow[];
  // What this harness measures — shown on the page.
  criterion_caveat: string;
  // Live-run proof: response computed on request.
  generated_at: string;
  run_duration_ms: number;
}

export interface ScenarioLeadTime {
  scenario: string;
  t_forecast_minutes: number | null;
  t_compound_minutes: number | null;
  t_single_sensor_minutes: number | null;
  lead_time_minutes: number | null;
}

export interface AblationRow {
  dimension: string;
  label: string;
  facts_removed: string[];
  recall: number;
  recall_drop: number;
  fn: number;
  tp: number;
}

export function fetchEvalSummary(): Promise<EvalSummary> {
  return request<EvalSummary>("/api/eval/summary");
}

// --- Shift handover ---------------------------------------------------------
// Shapes come from @/shared/schemas rather than being redeclared here; the old
// brief type was hand-duplicated and drifted from an untyped backend response.

export function fetchCurrentHandover(): Promise<Handover | null> {
  return request<Handover | null>("/handover/current");
}

export function fetchHandoverGaps(): Promise<HandoverGap[]> {
  return request<HandoverGap[]>("/handover/gaps");
}

export function fetchHandoverMetrics(): Promise<HandoverMetrics> {
  return request<HandoverMetrics>("/handover/metrics");
}

export function draftHandover(
  incomingActorId: string,
  windowHours = 12,
): Promise<Handover> {
  return request<Handover>("/handover/draft", {
    method: "POST",
    body: JSON.stringify({
      incoming_actor_id: incomingActorId,
      window_hours: windowHours,
    }),
  });
}

export function addHandoverNote(
  handoverId: string,
  note: { title: string; detail?: string | null; requires_ack: boolean },
): Promise<Handover> {
  return request<Handover>(`/handover/${handoverId}/notes`, {
    method: "POST",
    body: JSON.stringify(note),
  });
}

export function removeHandoverItem(
  handoverId: string,
  itemId: string,
): Promise<Handover> {
  return request<Handover>(`/handover/${handoverId}/items/${itemId}`, {
    method: "DELETE",
  });
}

export function issueHandover(handoverId: string): Promise<Handover> {
  return request<Handover>(`/handover/${handoverId}/issue`, { method: "POST" });
}

export function acknowledgeHandoverItem(
  handoverId: string,
  itemId: string,
  ackState: HandoverAckState = "acknowledged",
  note?: string | null,
): Promise<Handover> {
  return request<Handover>(`/handover/${handoverId}/items/${itemId}/ack`, {
    method: "POST",
    body: JSON.stringify({ ack_state: ackState, note: note ?? null }),
  });
}

export function acknowledgeAllHandoverItems(
  handoverId: string,
): Promise<Handover> {
  return request<Handover>(`/handover/${handoverId}/items/ack-all`, {
    method: "POST",
  });
}

export function acceptHandover(handoverId: string): Promise<Handover> {
  return request<Handover>(`/handover/${handoverId}/accept`, { method: "POST" });
}

// --- W1 · Emergency Response Orchestrator ------------------------------------

export interface ResponsePage {
  id: string;
  action_id: string;
  role: string;
  zone: string;
  channel: string;
  escalation_order: number;
  status: string;
  dispatched_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  escalated_from_id?: string | null;
  simulated: boolean;
}

export interface ResponseEnvelope {
  tier: number;
  reversible: boolean;
  blast_radius: string;
  commanded_state?: string | null;
  reversal?: string;
  /** Every clause and whether it held — drives the envelope explainer. */
  clauses: Record<string, boolean>;
  allowed: boolean;
  refusal_reason?: string | null;
}

export interface ResponseAction {
  id: string;
  review_id: string;
  asset_id?: string | null;
  asset_name?: string | null;
  tier: number;
  action_kind: string;
  label: string;
  status: string;
  device_id?: string | null;
  device_label?: string | null;
  device_zone?: string | null;
  device_kind?: string | null;
  device_state?: string | null;
  envelope: ResponseEnvelope;
  refusal_reason?: string | null;
  actor: string;
  armed_at?: string | null;
  /** When an armed action fires. The gap to now() is the abort window. */
  execute_after?: string | null;
  executed_at?: string | null;
  aborted_at?: string | null;
  revoked_at?: string | null;
  revoked_by?: string | null;
  revoke_reason?: string | null;
  created_at: string;
  pages: ResponsePage[];
  simulated: boolean;
}

export interface ResponseDevice {
  id: string;
  asset_id?: string | null;
  zone: string;
  kind: string;
  label: string;
  state: string;
  default_state: string;
  fail_safe_state: string;
  controllable: boolean;
  simulated: boolean;
}

export interface ResponseConfig {
  auto_enabled: boolean;
  arm_window_seconds: number;
  page_ack_timeout_seconds: number;
  dispatcher: Record<string, unknown>;
}

export function fetchActiveResponseActions(): Promise<ResponseAction[]> {
  return request<ResponseAction[]>("/response/active");
}

export function fetchResponseDevices(): Promise<ResponseDevice[]> {
  return request<ResponseDevice[]>("/response/devices");
}

export function fetchReviewResponseActions(
  reviewId: string,
): Promise<ResponseAction[]> {
  return request<ResponseAction[]>(`/response/reviews/${reviewId}/actions`);
}

export function abortResponseAction(actionId: string): Promise<ResponseAction> {
  return request<ResponseAction>(`/response/actions/${actionId}/abort`, {
    method: "POST",
  });
}

export function revokeResponseAction(
  actionId: string,
  reason?: string | null,
): Promise<ResponseAction> {
  return request<ResponseAction>(`/response/actions/${actionId}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

export function acknowledgeResponsePage(pageId: string): Promise<ResponsePage> {
  return request<ResponsePage>(`/response/pages/${pageId}/ack`, {
    method: "POST",
  });
}

export function fetchResponseConfig(): Promise<ResponseConfig> {
  return request<ResponseConfig>("/response/config");
}

export function putResponseConfig(
  autoEnabled: boolean,
): Promise<ResponseConfig> {
  return request<ResponseConfig>("/response/config", {
    method: "PUT",
    body: JSON.stringify({ auto_enabled: autoEnabled }),
  });
}

// ── Operating history (W11b) ────────────────────────────────────────────────

export interface HistoryFactCount {
  fact_type: string;
  count: number;
}

export interface HistoryVerdictMonth {
  month: string; // YYYY-MM
  nominal: number;
  elevated: number;
  blocking: number;
}

export interface HistoryCitedAuthority {
  source: string; // "regulations" | "sops"
  label: string;
  citations: number;
  reviews: number;
}

export interface HistoryOverview {
  window_months: number;
  review_count: number;
  first_review_at: string | null;
  last_review_at: string | null;
  fact_distribution: HistoryFactCount[];
  verdicts_by_month: HistoryVerdictMonth[];
  top_authorities: HistoryCitedAuthority[];
}

export function fetchHistoryOverview(months = 12): Promise<HistoryOverview> {
  return request<HistoryOverview>(`/history/overview?months=${months}`);
}

// --- W13 · pattern discovery -------------------------------------------------

export type PatternFamily =
  | "recurrence"
  | "asset_pair"
  | "shift_band"
  | "within_event";

export type PatternState = "candidate" | "ratified" | "dismissed";

export interface MinedPattern {
  key: string;
  family: PatternFamily;
  /** The finding in plain words — the headline a supervisor reads. */
  claim: string;
  hits: number;
  trials: number;
  rate: number;
  base_rate: number;
  /** How much more often than the base rate. "lift", said in English. */
  ratio: number;
  /** Why no rule could state this. Empty when one already does. */
  why_no_rule: string;
  covered_by: string | null;
  review_ids: string[];
  state: PatternState;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
}

export interface MinedScope {
  window_months: number;
  review_count: number;
  asset_count: number;
  first_review_at: string | null;
  last_review_at: string | null;
  min_support: number;
  min_ratio: number;
  alpha: number;
}

export interface PatternsView {
  scope: MinedScope;
  patterns: MinedPattern[];
  corpus_is_seeded: boolean;
}

export function fetchPatterns(months = 12): Promise<PatternsView> {
  return request<PatternsView>(`/api/patterns?months=${months}`);
}

export function ratifyPattern(
  key: string,
  note?: string | null,
): Promise<MinedPattern> {
  return request<MinedPattern>(
    `/api/patterns/${encodeURIComponent(key)}/ratify`,
    { method: "POST", body: JSON.stringify({ note: note ?? null }) },
  );
}

export function dismissPattern(
  key: string,
  note?: string | null,
): Promise<MinedPattern> {
  return request<MinedPattern>(
    `/api/patterns/${encodeURIComponent(key)}/dismiss`,
    { method: "POST", body: JSON.stringify({ note: note ?? null }) },
  );
}
