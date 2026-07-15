/**
 * Frontend-only mock layer for Phase 1 walking skeleton.
 * Typed against shared contracts. compound_risk terminal state
 * reuses the Phase 0 fixture so the story stays consistent.
 */

import type {
  Assessment,
  Asset,
  Context,
  Decision,
  DerivedFact,
  RetrievedReference,
  Review,
} from "@/shared/schemas";
import type { RiskLevel } from "@/shared/enums";
import fixtures from "@/shared/fixtures.json";

export type ScenarioName = "gas_leak" | "permit_conflict" | "compound_risk";

export interface IncidentSnippet {
  id: string;
  title: string;
  occurred_at: string;
}

export interface AssetRuntime {
  asset: Asset;
  risk_level: RiskLevel;
  context: Context[];
  derived_facts: DerivedFact[];
  references: RetrievedReference[];
  review: Review | null;
  assessment: Assessment | null;
  decision: Decision | null;
  incidents: IncidentSnippet[];
}

export interface ScenarioStep {
  delay_ms: number;
  asset_id: string;
  risk_level: RiskLevel;
  context?: Context[];
  derived_facts?: DerivedFact[];
  references?: RetrievedReference[];
  review?: Review;
  assessment?: Assessment | null;
  decision?: Decision | null;
}

export const EXTRA_ASSETS: Asset[] = [
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Compressor B",
    zone: "compressor-yard",
    plant_id: "plant-1",
    floor: "ground",
  },
  {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Tank Farm C",
    zone: "tank-farm",
    plant_id: "plant-1",
    floor: "ground",
  },
];

export const ALL_ASSETS: Asset[] = [
  ...(fixtures.assets as Asset[]),
  ...EXTRA_ASSETS,
];

const VESSEL_A = "11111111-1111-1111-1111-111111111111";
const WALKWAY_3 = "22222222-2222-2222-2222-222222222222";
const COMPRESSOR_B = "33333333-3333-3333-3333-333333333333";
const SUPERVISOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const FIXTURE_REVIEW = fixtures.review as Review;
const FIXTURE_FACTS = fixtures.derived_facts as DerivedFact[];
const FIXTURE_CONTEXT = fixtures.context as Context[];
const FIXTURE_REFS = fixtures.retrieved_references as RetrievedReference[];
const FIXTURE_ASSESSMENT = fixtures.assessment as Assessment;

function emptyRuntime(asset: Asset): AssetRuntime {
  return {
    asset,
    risk_level: "nominal",
    context: [],
    derived_facts: [],
    references: [],
    review: null,
    assessment: null,
    decision: null,
    incidents: [],
  };
}

/** Baseline: all assets nominal, Walkway 3 has a faint incident history for flavor. */
export function buildBaselineRuntimes(): Record<string, AssetRuntime> {
  const map: Record<string, AssetRuntime> = {};
  for (const asset of ALL_ASSETS) {
    map[asset.id] = emptyRuntime(asset);
  }
  map[WALKWAY_3].incidents = [
    {
      id: "inc-hist-1",
      title: "Near-miss: worker entered restricted lane without radio check",
      occurred_at: "2026-06-02T14:20:00Z",
    },
  ];
  return map;
}

const GAS_LEAK_CTX: Context = {
  id: "ctx-gas-001",
  asset_id: VESSEL_A,
  category: "sensor",
  payload: { gas_reading: 18.2, unit: "ppm" },
  provider: "simulator",
  valid_from: "2026-07-14T06:01:00Z",
  valid_until: "2026-07-14T07:01:00Z",
  confidence: 0.97,
};

const GAS_LEAK_FACT: DerivedFact = {
  id: "df-gas-001",
  asset_id: VESSEL_A,
  fact_type: "elevated_gas",
  value: true,
  computed_at: "2026-07-14T06:01:30Z",
  source_context_ids: ["ctx-gas-001"],
};

const GAS_LEAK_REVIEW: Review = {
  id: "rev-gas-001",
  asset_id: VESSEL_A,
  state: "pending_decision",
  owner_id: SUPERVISOR,
  triggered_by: "gas_leak",
  created_at: "2026-07-14T06:02:00Z",
};

const GAS_LEAK_ASSESSMENT: Assessment = {
  id: "as-gas-001",
  review_id: "rev-gas-001",
  assessment_type: "ai",
  status: "complete",
  risk_level: "elevated",
  summary:
    "Gas reading above threshold at Vessel A. Isolation intact; no workers in zone. Recommend pause and re-sample.",
  recommendations: [
    {
      id: "rc-gas-001",
      text: "Pause hot-work adjacent to Vessel A until reading clears.",
      rationale: "Elevated gas alone warrants caution even without occupants.",
      disposition: "proposed",
    },
  ],
  derived_fact_ids: ["df-gas-001"],
  metadata: {
    provider: "mock",
    model: "mock-v1",
    prompt_version: "v0",
    input_tokens: 400,
    output_tokens: 120,
    estimated_cost_usd: 0,
    latency_ms: 30,
    timestamp: "2026-07-14T06:02:00Z",
    retrieved_context_ids: ["ctx-gas-001"],
    retrieved_evidence_ids: ["reg-gas-001"],
    retrieval_mode: "deterministic",
    retrieval_quality: "good",
    retrieval_score: null,
    embedding_model: null,
    confidence: 0.88,
    assessment_version: 1,
  },
};

const PERMIT_CTX: Context = {
  id: "ctx-perm-001",
  asset_id: COMPRESSOR_B,
  category: "permit",
  payload: {
    permit_id: "p-hot-2",
    status: "active",
    work_type: "hot_work",
    conflicts_with: "p-confined-1",
  },
  provider: "simulator",
  valid_from: "2026-07-14T06:00:00Z",
  valid_until: "2026-07-14T10:00:00Z",
  confidence: 1,
};

const PERMIT_FACT: DerivedFact = {
  id: "df-perm-001",
  asset_id: COMPRESSOR_B,
  fact_type: "permit_conflict",
  value: true,
  computed_at: "2026-07-14T06:01:00Z",
  source_context_ids: ["ctx-perm-001"],
};

const PERMIT_REVIEW: Review = {
  id: "rev-perm-001",
  asset_id: COMPRESSOR_B,
  state: "pending_decision",
  owner_id: SUPERVISOR,
  triggered_by: "permit_conflict",
  created_at: "2026-07-14T06:01:30Z",
};

const PERMIT_ASSESSMENT: Assessment = {
  id: "as-perm-001",
  review_id: "rev-perm-001",
  assessment_type: "ai",
  status: "complete",
  risk_level: "elevated",
  summary:
    "Active hot-work and confined-space permits overlap on Compressor B. Resolve conflict before either crew proceeds.",
  recommendations: [
    {
      id: "rc-perm-001",
      text: "Suspend one permit until the other is closed or geographically separated.",
      rationale: "Concurrent incompatible permits are a known SIMOPS precursor.",
      disposition: "proposed",
    },
  ],
  derived_fact_ids: ["df-perm-001"],
  metadata: {
    provider: "mock",
    model: "mock-v1",
    prompt_version: "v0",
    input_tokens: 380,
    output_tokens: 110,
    estimated_cost_usd: 0,
    latency_ms: 28,
    timestamp: "2026-07-14T06:01:45Z",
    retrieved_context_ids: ["ctx-perm-001"],
    retrieved_evidence_ids: ["sop-perm-001"],
    retrieval_mode: "deterministic",
    retrieval_quality: "good",
    retrieval_score: null,
    embedding_model: null,
    confidence: 0.9,
    assessment_version: 1,
  },
};

export const SCENARIO_LABELS: Record<ScenarioName, string> = {
  gas_leak: "Gas Leak",
  permit_conflict: "Permit Conflict",
  compound_risk: "Compound Risk",
};

export const SCENARIOS: Record<ScenarioName, ScenarioStep[]> = {
  gas_leak: [
    {
      delay_ms: 0,
      asset_id: VESSEL_A,
      risk_level: "elevated",
      context: [GAS_LEAK_CTX],
      derived_facts: [GAS_LEAK_FACT],
      references: [],
      review: { ...GAS_LEAK_REVIEW, state: "assessing" },
      assessment: null,
    },
    {
      delay_ms: 1200,
      asset_id: VESSEL_A,
      risk_level: "elevated",
      context: [GAS_LEAK_CTX],
      derived_facts: [GAS_LEAK_FACT],
      references: [
        {
          source: "regulations",
          id: "reg-gas-001",
          retrieval_path: "deterministic",
          score: null,
          chunk_id: null,
        },
      ],
      review: GAS_LEAK_REVIEW,
      assessment: GAS_LEAK_ASSESSMENT,
    },
  ],
  permit_conflict: [
    {
      delay_ms: 0,
      asset_id: COMPRESSOR_B,
      risk_level: "elevated",
      context: [PERMIT_CTX],
      derived_facts: [PERMIT_FACT],
      references: [],
      review: { ...PERMIT_REVIEW, state: "assessing" },
      assessment: null,
    },
    {
      delay_ms: 1000,
      asset_id: COMPRESSOR_B,
      risk_level: "elevated",
      context: [PERMIT_CTX],
      derived_facts: [PERMIT_FACT],
      references: [
        {
          source: "sops",
          id: "sop-perm-001",
          retrieval_path: "deterministic",
          score: null,
          chunk_id: null,
        },
      ],
      review: PERMIT_REVIEW,
      assessment: PERMIT_ASSESSMENT,
    },
  ],
  compound_risk: [
    {
      delay_ms: 0,
      asset_id: VESSEL_A,
      risk_level: "elevated",
      context: [FIXTURE_CONTEXT[0]],
      derived_facts: [FIXTURE_FACTS[0]],
      references: [],
      review: {
        ...FIXTURE_REVIEW,
        state: "assessing",
        triggered_by: "compound_risk",
      },
      assessment: null,
    },
    {
      delay_ms: 900,
      asset_id: VESSEL_A,
      risk_level: "elevated",
      context: FIXTURE_CONTEXT.slice(0, 2),
      derived_facts: FIXTURE_FACTS.slice(0, 2),
      references: [],
      review: {
        ...FIXTURE_REVIEW,
        state: "assessing",
        triggered_by: "compound_risk",
      },
      assessment: null,
    },
    {
      delay_ms: 1100,
      asset_id: VESSEL_A,
      risk_level: "blocking",
      context: FIXTURE_CONTEXT,
      derived_facts: FIXTURE_FACTS,
      references: FIXTURE_REFS,
      review: FIXTURE_REVIEW,
      assessment: FIXTURE_ASSESSMENT,
    },
  ],
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];

/** Pre-seed one review so ReviewList is non-empty before any scenario plays. */
export function applySeedReview(
  runtimes: Record<string, AssetRuntime>,
): Record<string, AssetRuntime> {
  const next = { ...runtimes };
  const vessel = { ...next[VESSEL_A] };
  vessel.risk_level = "blocking";
  vessel.context = FIXTURE_CONTEXT;
  vessel.derived_facts = FIXTURE_FACTS;
  vessel.references = FIXTURE_REFS;
  vessel.review = FIXTURE_REVIEW;
  vessel.assessment = FIXTURE_ASSESSMENT;
  vessel.incidents = [
    {
      id: "inc00001-0000-0000-0000-000000000001",
      title: "Near-miss: gas + occupied zone during hot-work (echo)",
      occurred_at: "2025-11-18T09:40:00Z",
    },
  ];
  next[VESSEL_A] = vessel;
  return next;
}
