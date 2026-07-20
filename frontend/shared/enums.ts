/** Canonical enums / literal unions — frozen in Phase 0 (TDS §8). */

export type ReviewState =
  | "opened"
  | "assessing"
  | "pending_decision"
  | "decided"
  | "escalated"
  | "closed"
  | "reopened";

export type AssessmentType = "ai" | "manual";

export type AssessmentStatus =
  | "pending"
  | "generating"
  | "complete"
  | "failed"
  | "superseded";

export type RiskLevel = "nominal" | "elevated" | "blocking";

export type DecisionOutcome =
  | "approved"
  | "approved_with_conditions"
  | "blocked";

export type RecommendationDisposition = "proposed" | "accepted" | "rejected";

export type FactType =
  | "elevated_gas"
  | "critical_gas"
  | "permit_conflict"
  | "zone_occupied"
  | "incomplete_isolation"
  | "simultaneous_ops"
  | "certification_expiring"
  | "over_temperature"
  | "critical_temperature"
  | "equipment_vibration_anomaly"
  | "effluent_quality_breach"
  | "tank_level_critical"
  | "ppe_noncompliance"
  | "lifting_operation_conflict"
  | "weather_hold";

export type PlantFloor = "ground" | "first" | "second";

export type ReferenceSource =
  | "regulations"
  | "historical_incidents"
  | "sops";

export type RetrievalPath = "rag" | "deterministic";

export type RetrievalMode = "rag" | "deterministic" | "skipped";

export type RetrievalQuality = "good" | "weak" | "empty" | "n_a";

export type AiProviderName = "openai" | "ollama" | "mock" | "manual";
