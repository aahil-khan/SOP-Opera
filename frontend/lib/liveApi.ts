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
  ManualAssessmentIn,
  Notification,
  ReasoningFactor,
  Report,
  RetrievedReference,
  Review,
} from "@/shared/schemas";
import type { DecisionOutcome, RiskLevel } from "@/shared/enums";
import { API_BASE } from "@/lib/api";

export interface ReviewDetail {
  review: Review;
  asset: Asset;
  context: Context[];
  derived_facts: DerivedFact[];
  decision: Decision | null;
  area_owner?: AreaOwner | null;
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
}

export interface ReportSummary {
  id: string;
  review_id: string;
  closure_event_seq: number;
  generated_at: string;
  title: string | null;
  asset_name: string | null;
  outcome: string | null;
  risk_level: string | null;
}

export interface AiOpsSummary {
  total_assessments: number;
  complete_count: number;
  failed_count: number;
  success_rate: number;
  validation_failure_count: number;
  provider_error_count: number;
  rag_hit_rate: number;
  rag_fallback_rate: number;
  mean_retrieval_relevance: number | null;
  retrieval_ran_count: number;
}

export interface ShiftHandoverOpenReview {
  review_id: string;
  asset_id: string;
  asset_name: string;
  state: string;
  risk_level: string;
  label?: string;
}

export interface ShiftHandoverBrief {
  brief: string;
  window_hours: number;
  provider: string;
  model: string;
  active_facts: string[];
  open_reviews: Array<ShiftHandoverOpenReview | string>;
  attention_asset_id?: string | null;
  signal_count: number;
  generated_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
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
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${res.status}): ${detail}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function fetchAssets(): Promise<Asset[]> {
  return request<Asset[]>("/assets");
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

export function fetchReports(): Promise<ReportSummary[]> {
  return request<ReportSummary[]>("/reports");
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

export function fetchAiOpsSummary(): Promise<AiOpsSummary> {
  return request<AiOpsSummary>("/ai-ops/summary");
}

export function fetchShiftHandover(windowHours = 12): Promise<ShiftHandoverBrief> {
  return request<ShiftHandoverBrief>(
    `/agents/shift-handover?window_hours=${windowHours}`,
    { method: "POST" },
  );
}
