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
}

export interface Decision {
  id: string;
  review_id: string;
  assessment_id: string;
  decided_by: string;
  outcome: DecisionOutcome;
  recommendation_dispositions: Record<string, "accepted" | "rejected">;
  conditions: string | null;
  submitted_at: string;
}

export interface Review {
  id: string;
  asset_id: string;
  state: ReviewState;
  owner_id: string;
  triggered_by: string;
  created_at: string;
}

export interface Asset {
  id: string;
  name: string;
  zone: string;
  plant_id: string;
}
