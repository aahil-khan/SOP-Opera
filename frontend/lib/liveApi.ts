/**
 * Live FastAPI client for Phase 4 — typed against shared contracts.
 */

import type {
  Assessment,
  Asset,
  Context,
  Decision,
  DerivedFact,
  ManualAssessmentIn,
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
}

export interface AssessmentHistoryItem extends Omit<Assessment, "risk_level" | "summary"> {
  risk_level: RiskLevel | null;
  summary: string | null;
  version: number;
  created_at: string | null;
  retrieved_references: RetrievedReference[];
  metadata: Assessment["metadata"] & {
    input_tokens?: number;
    output_tokens?: number;
    estimated_cost_usd?: number;
    assessment_version?: number;
  } | null;
}

export interface DecisionIn {
  outcome: DecisionOutcome;
  recommendation_dispositions: Record<string, "accepted" | "rejected">;
  conditions: string | null;
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
