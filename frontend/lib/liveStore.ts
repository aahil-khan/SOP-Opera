"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type {
  Assessment,
  Asset,
  Decision,
  Notification,
  Review,
} from "@/shared/schemas";
import type { RiskLevel } from "@/shared/enums";
import { riskForSupervisorConcern } from "@/lib/supervisorConcern";
import {
  fetchAssets,
  fetchNotifications,
  fetchRecentTelemetry,
  fetchReviewAssessments,
  fetchReviewDetail,
  fetchReviews,
  fetchThresholds,
  postCloseReview,
  postReopenReview,
  postDecision,
  postManualAssessment,
  postRetryAssessment,
  type AssessmentHistoryItem,
  type DecisionIn,
  type ReviewDetail,
} from "@/lib/liveApi";
import type { ManualAssessmentIn } from "@/shared/schemas";
import {
  dismissAllNotificationToasts,
  dismissNotificationToast,
  showNotificationToast,
  showReassessmentToast,
} from "@/lib/notificationToast";
import { isDndEnabled } from "@/lib/dndMode";
import {
  assetHasSensorCritical,
  DEFAULT_THRESHOLDS,
  type ThresholdsConfig,
} from "@/lib/sensorThresholds";
import {
  isAlertNotification,
  presentNotification,
} from "@/lib/notificationPresentation";
import type { SpatialLinkView } from "@/lib/spatialLinks";
import { spatialLinksFromAssessment } from "@/lib/spatialLinks";
import {
  EMPTY_OPS_SUMMARY,
  refreshOpsChipsByAsset,
  refreshOpsSummary,
  type AssetOpsChips,
  type OpsSummary,
} from "@/lib/opsChips";

export type { OpsSummary };

export type { SpatialLinkView };
export { spatialLinksFromAssessment };

/** Matches DomainId in lib/domains — kept here to avoid a circular import. */
export type AssetDomainFocus =
  | "sensors"
  | "permits"
  | "people"
  | "evidence"
  | "spatial";

export type DomainFocusRequest = {
  assetId: string;
  domain: AssetDomainFocus;
  nonce: number;
};

const NOTIFICATION_CAP = 50;
const AGENT_STEP_CAP = 100;
const TELEMETRY_RING_CAP = 30;
/** Coalesce rapid soft samples into one Zustand write. */
const TELEMETRY_FLUSH_MS = 250;
/** Coalesce bursty domain WS events into one reviews refetch. */
const OVERVIEW_REFRESH_DEBOUNCE_MS = 400;


export type TelemetrySource = "scada" | "ptw" | "maintenance" | "workforce" | string;

export type TelemetryMetricKey =
  | "gas_reading"
  | "temp_reading"
  | "vibration_mm_s"
  | "level_pct"
  | "ph"
  | "wind_ms";

export interface TelemetryPoint {
  t: number;
  v: number;
}

export interface TelemetrySample {
  source: TelemetrySource;
  asset_id: string;
  asset_name?: string;
  category: string;
  payload: Record<string, unknown>;
  ts: string;
  mode?: string;
}

export interface TelemetryStatusChip {
  source: TelemetrySource;
  asset_id: string;
  category: string;
  label: string;
  ts: string;
}

const NUMERIC_METRICS: TelemetryMetricKey[] = [
  "gas_reading",
  "temp_reading",
  "vibration_mm_s",
  "level_pct",
  "ph",
  "wind_ms",
];

function ringKey(assetId: string, metric: string): string {
  return `${assetId}::${metric}`;
}

function statusLabel(category: string, payload: Record<string, unknown>): string {
  if (category === "permit") {
    return `Permit ${String(payload.status ?? "?")} · ${String(payload.work_type ?? "").replaceAll("_", " ")}`;
  }
  if (category === "isolation_status") {
    return payload.complete ? "Isolation complete" : "Isolation incomplete";
  }
  if (category === "worker_location") {
    return `Worker · ${String(payload.zone ?? "?")}`;
  }
  if (category === "ppe_status") {
    return payload.compliant === false
      ? `PPE missing ${String(payload.missing ?? "")}`
      : "PPE compliant";
  }
  if (category === "lift_plan") {
    return `Lift ${String(payload.status ?? "?")}`;
  }
  return category;
}

function ingestTelemetrySample(
  state: {
    telemetrySeries: Record<string, TelemetryPoint[]>;
    telemetryLatest: Record<string, TelemetrySample>;
    telemetryBySource: Record<string, TelemetrySample>;
    telemetryStatus: TelemetryStatusChip[];
  },
  sample: TelemetrySample,
): {
  telemetrySeries: Record<string, TelemetryPoint[]>;
  telemetryLatest: Record<string, TelemetrySample>;
  telemetryBySource: Record<string, TelemetrySample>;
  telemetryStatus: TelemetryStatusChip[];
} {
  const t = Date.parse(sample.ts) || Date.now();
  // Mutate copies once per sample; callers batch then single set()
  const series = state.telemetrySeries;
  let touchedNumeric = false;
  for (const key of NUMERIC_METRICS) {
    const raw = sample.payload[key];
    if (typeof raw !== "number") continue;
    touchedNumeric = true;
    const rk = ringKey(sample.asset_id, key);
    const prev = series[rk];
    if (prev) {
      if (prev.length >= TELEMETRY_RING_CAP) {
        series[rk] = [...prev.slice(-(TELEMETRY_RING_CAP - 1)), { t, v: raw }];
      } else {
        series[rk] = [...prev, { t, v: raw }];
      }
    } else {
      series[rk] = [{ t, v: raw }];
    }
  }

  state.telemetryLatest[sample.asset_id] = sample;
  state.telemetryBySource[`${sample.source}:${sample.asset_id}`] = sample;
  state.telemetryBySource[sample.source] = sample;

  if (
    ["permit", "isolation_status", "worker_location", "ppe_status", "lift_plan"].includes(
      sample.category,
    )
  ) {
    const chip: TelemetryStatusChip = {
      source: sample.source,
      asset_id: sample.asset_id,
      category: sample.category,
      label: statusLabel(sample.category, sample.payload),
      ts: sample.ts,
    };
    state.telemetryStatus = [
      chip,
      ...state.telemetryStatus.filter(
        (c) => !(c.asset_id === chip.asset_id && c.category === chip.category),
      ),
    // One entry per asset×category across the plant (~27×4); keep headroom.
    ].slice(0, 120);
  } else if (!touchedNumeric) {
    /* ignore */
  }

  return {
    telemetrySeries: series,
    telemetryLatest: state.telemetryLatest,
    telemetryBySource: state.telemetryBySource,
    telemetryStatus: state.telemetryStatus,
  };
}

function applyTelemetrySamples(
  state: {
    telemetrySeries: Record<string, TelemetryPoint[]>;
    telemetryLatest: Record<string, TelemetrySample>;
    telemetryBySource: Record<string, TelemetrySample>;
    telemetryStatus: TelemetryStatusChip[];
  },
  samples: TelemetrySample[],
) {
  // Shallow-clone containers once for the whole batch
  const draft = {
    telemetrySeries: { ...state.telemetrySeries },
    telemetryLatest: { ...state.telemetryLatest },
    telemetryBySource: { ...state.telemetryBySource },
    telemetryStatus: state.telemetryStatus,
  };
  for (const sample of samples) {
    ingestTelemetrySample(draft, sample);
  }
  return {
    telemetrySeries: draft.telemetrySeries,
    telemetryLatest: draft.telemetryLatest,
    telemetryBySource: draft.telemetryBySource,
    telemetryStatus: draft.telemetryStatus,
  };
}

function asTelemetrySample(
  payload: Record<string, unknown>,
): TelemetrySample | null {
  if (typeof payload.asset_id !== "string") return null;
  if (typeof payload.category !== "string") return null;
  const rawPayload = payload.payload;
  if (!rawPayload || typeof rawPayload !== "object") return null;
  return {
    source: typeof payload.source === "string" ? payload.source : "scada",
    asset_id: payload.asset_id,
    asset_name:
      typeof payload.asset_name === "string" ? payload.asset_name : undefined,
    category: payload.category,
    payload: rawPayload as Record<string, unknown>,
    ts:
      typeof payload.ts === "string"
        ? payload.ts
        : new Date().toISOString(),
    mode: typeof payload.mode === "string" ? payload.mode : undefined,
  };
}


export type AgentStepKind =
  | "started"
  | "tool_call"
  | "observation"
  | "local_risk"
  | "verdict"
  | "completed"
  | "error";

export type AgentFinding = "risk" | "clearance" | "neutral";

export interface AgentStepEvent {
  id: string;
  agent: string;
  kind: AgentStepKind;
  message: string;
  review_id: string | null;
  assessment_id: string | null;
  finding: AgentFinding;
  detail: Record<string, unknown>;
  ts: string;
}

export interface LiveAssetView {
  asset: Asset;
  risk_level: RiskLevel;
  /** Deep-red sensor incident threshold crossed (derived fact or live reading). */
  sensor_critical: boolean;
  review: Review | null;
  assessment: AssessmentHistoryItem | null;
  detail: ReviewDetail | null;
}

interface LiveState {
  assets: Asset[];
  reviews: Review[];
  reviewDetails: Record<string, ReviewDetail>;
  assessmentsByReview: Record<string, AssessmentHistoryItem[]>;
  notifications: Notification[];
  /** WebSocket-driven task change signal for supervisor dashboards. */
  taskEventSeq: number;
  /** Review/decision events for supervisor board refresh. */
  boardEventSeq: number;
  /** WebSocket-driven comment change signal for review threads. */
  commentEventSeq: number;
  lastCommentReviewId: string | null;
  /** Client-side unread ids (bootstrap history starts as read). */
  unreadNotificationIds: string[];
  /** Agent steps keyed by review id (null-scoped → `_unscoped`). */
  agentStepsByReview: Record<string, AgentStepEvent[]>;
  telemetrySeries: Record<string, TelemetryPoint[]>;
  telemetryLatest: Record<string, TelemetrySample>;
  telemetryBySource: Record<string, TelemetrySample>;
  telemetryStatus: TelemetryStatusChip[];
  selectedAssetId: string | null;
  /** Right AssetPanel mode on the Digital Twin. */
  assetPanelMode: "summary" | "fullReview";
  /** One-shot pin request for DomainRadar (map spatial links → pentagon). */
  domainFocusRequest: DomainFocusRequest | null;
  /** Effective sensor/rule thresholds from GET /api/config/thresholds. */
  thresholdsConfig: ThresholdsConfig;
  setThresholdsConfig: (config: ThresholdsConfig) => void;
  refreshThresholds: () => Promise<ThresholdsConfig>;
  /** Sparse map — only assets with active sensor-critical readings/facts. */
  sensorCriticalByAsset: Record<string, boolean>;
  /** Per-asset permit / isolation / workforce chips — patched on telemetry flush. */
  opsChipsByAsset: Record<string, AssetOpsChips>;
  /** Plant-wide ops KPI counters — patched with opsChipsByAsset. */
  opsSummary: OpsSummary;
  bootstrapped: boolean;
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  refreshOverview: () => Promise<void>;
  loadReviewDetail: (id: string) => Promise<void>;
  submitDecision: (id: string, body: DecisionIn) => Promise<Decision>;
  closeReview: (id: string) => Promise<Review>;
  reopenReview: (id: string, reason?: string) => Promise<Review>;
  retryAssessment: (
    id: string,
    provider?: "openai_compatible" | "ollama" | "mock" | null,
  ) => Promise<void>;
  submitManualAssessment: (
    id: string,
    body: ManualAssessmentIn,
  ) => Promise<Assessment>;
  selectAsset: (id: string | null) => void;
  setAssetPanelMode: (mode: "summary" | "fullReview") => void;
  /** Select an asset and open the in-panel full review (deep links). */
  openAssetFullReview: (assetId: string) => void;
  /** Open asset summary panel with a domain pinned on the pentagon radar. */
  openAssetDomain: (assetId: string, domain: AssetDomainFocus) => void;
  clearDomainFocusRequest: () => void;
  loadNotifications: () => Promise<void>;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  markNotificationsRead: () => void;
  clearAgentSteps: () => void;
  clearTelemetry: () => void;
  handleRealtimeEvent: (type: string, payload: Record<string, unknown>) => void;
}

const EMPTY_AGENT_STEPS: AgentStepEvent[] = [];
const UNSCOPED_AGENT_KEY = "_unscoped";

function agentStepBucket(reviewId: string | null | undefined): string {
  return reviewId && reviewId.length > 0 ? reviewId : UNSCOPED_AGENT_KEY;
}

function appendAgentStep(
  byReview: Record<string, AgentStepEvent[]>,
  step: AgentStepEvent,
): Record<string, AgentStepEvent[]> {
  const key = agentStepBucket(step.review_id);
  const prev = byReview[key] ?? [];
  return {
    ...byReview,
    [key]: [...prev, step].slice(-AGENT_STEP_CAP),
  };
}

function latestComplete(
  items: AssessmentHistoryItem[] | undefined,
): AssessmentHistoryItem | null {
  if (!items?.length) return null;
  return (
    items.find((a) => a.status === "complete") ??
    items.find((a) => a.status === "failed") ??
    items[0] ??
    null
  );
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const rank: Record<RiskLevel, number> = {
    nominal: 0,
    elevated: 1,
    blocking: 2,
  };
  return rank[a] >= rank[b] ? a : b;
}

function deriveRisk(
  review: Review | null,
  assessment: AssessmentHistoryItem | null,
  detail: ReviewDetail | null,
): RiskLevel {
  if (!review) {
    return "nominal";
  }
  // Closed reviews are no longer active risk — resolved/halted styling is separate.
  if (review.state === "closed") {
    return "nominal";
  }

  // Decided but not closed: color by the operator decision so the asset
  // still reads as open work until Close Review.
  if (review.state === "decided") {
    const outcome = detail?.decision?.outcome;
    if (outcome === "blocked") return "blocking";
    // Approved / approved w/ conditions — soft amber until closed.
    return "elevated";
  }

  // Reassessment in flight — prefer live derived facts over stale assessment.
  if (review.state === "assessing" || review.state === "reopened") {
    const active =
      detail?.derived_facts?.filter(
        (f) => f.value === true || f.value === "true",
      ) ?? [];
    if (active.length >= 3) return "blocking";
    if (active.length > 0) return "elevated";
  }

  if (assessment?.status === "complete" && assessment.risk_level) {
    let risk = assessment.risk_level;
    if (review.origin === "supervisor" && detail?.supervisor_report) {
      risk = maxRisk(
        risk,
        riskForSupervisorConcern(detail.supervisor_report.concern_type),
      );
    }
    return risk;
  }
  if (detail?.derived_facts?.some((f) => f.value === true || f.value === "true")) {
    return "elevated";
  }
  if (review.origin === "supervisor" && detail?.supervisor_report) {
    return riskForSupervisorConcern(detail.supervisor_report.concern_type);
  }
  // Any other open review without a settled assessment still reads elevated.
  return "elevated";
}

function asNotification(payload: Record<string, unknown>): Notification | null {
  if (typeof payload.id !== "string" || typeof payload.summary !== "string") {
    return null;
  }
  return {
    id: payload.id,
    review_id: typeof payload.review_id === "string" ? payload.review_id : null,
    event_type: typeof payload.event_type === "string" ? payload.event_type : "unknown",
    summary: payload.summary,
    recipient_ids: Array.isArray(payload.recipient_ids)
      ? payload.recipient_ids.map(String)
      : [],
    created_at:
      typeof payload.created_at === "string"
        ? payload.created_at
        : new Date().toISOString(),
  };
}

function asAgentStep(payload: Record<string, unknown>): AgentStepEvent | null {
  if (typeof payload.agent !== "string" || typeof payload.message !== "string") {
    return null;
  }
  const kind = typeof payload.kind === "string" ? payload.kind : "observation";
  const rawFinding =
    typeof payload.finding === "string"
      ? payload.finding
      : typeof (payload.detail as { finding?: unknown } | undefined)?.finding ===
          "string"
        ? (payload.detail as { finding: string }).finding
        : "neutral";
  const finding: AgentFinding =
    rawFinding === "risk" || rawFinding === "clearance" || rawFinding === "neutral"
      ? rawFinding
      : "neutral";
  return {
    id: `${payload.agent}-${payload.ts ?? Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    agent: payload.agent,
    kind: kind as AgentStepKind,
    message: payload.message,
    review_id: typeof payload.review_id === "string" ? payload.review_id : null,
    assessment_id:
      typeof payload.assessment_id === "string" ? payload.assessment_id : null,
    finding,
    detail:
      payload.detail && typeof payload.detail === "object"
        ? (payload.detail as Record<string, unknown>)
        : {},
    ts:
      typeof payload.ts === "string" ? payload.ts : new Date().toISOString(),
  };
}

function derivedFactsForAsset(
  assetId: string,
  state: Pick<LiveState, "reviews" | "reviewDetails">,
) {
  const review = state.reviews.find((r) => r.asset_id === assetId);
  if (!review) return undefined;
  return state.reviewDetails[review.id]?.derived_facts;
}

type SensorCriticalState = Pick<
  LiveState,
  | "telemetrySeries"
  | "telemetryLatest"
  | "thresholdsConfig"
  | "reviews"
  | "reviewDetails"
>;

function computeSensorCritical(
  assetId: string,
  state: SensorCriticalState,
): boolean {
  return assetHasSensorCritical(
    assetId,
    derivedFactsForAsset(assetId, state),
    state.telemetrySeries,
    state.telemetryLatest,
    state.thresholdsConfig,
  );
}

/** Patch only assets whose critical flag changed — avoids new map refs on no-op flushes. */
function patchSensorCriticalForAssets(
  prev: Record<string, boolean>,
  state: SensorCriticalState,
  assetIds: Iterable<string>,
): Record<string, boolean> {
  let next: Record<string, boolean> | null = null;
  for (const assetId of assetIds) {
    const critical = computeSensorCritical(assetId, state);
    const was = prev[assetId] ?? false;
    if (critical === was) continue;
    if (!next) next = { ...prev };
    if (critical) next[assetId] = true;
    else delete next[assetId];
  }
  return next ?? prev;
}

function buildSensorCriticalMap(
  assets: Asset[],
  state: SensorCriticalState,
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const asset of assets) {
    if (computeSensorCritical(asset.id, state)) {
      map[asset.id] = true;
    }
  }
  return map;
}

export const useLiveStore = create<LiveState>((set, get) => {
  const pendingTelemetry: TelemetrySample[] = [];
  let telemetryFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let overviewRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const flushTelemetry = () => {
    telemetryFlushTimer = null;
    if (pendingTelemetry.length === 0) return;
    const batch = pendingTelemetry.splice(0, pendingTelemetry.length);
    const touched = new Set(batch.map((s) => s.asset_id));
    set((state) => {
      const hydrated = applyTelemetrySamples(state, batch);
      const merged = { ...state, ...hydrated };
      const opsChipsByAsset = refreshOpsChipsByAsset(
        state.opsChipsByAsset,
        merged.telemetryStatus,
        merged.telemetryBySource,
      );
      const opsSummary =
        opsChipsByAsset === state.opsChipsByAsset
          ? state.opsSummary
          : refreshOpsSummary(state.opsSummary, opsChipsByAsset);
      return {
        ...hydrated,
        sensorCriticalByAsset: patchSensorCriticalForAssets(
          state.sensorCriticalByAsset,
          merged,
          touched,
        ),
        opsChipsByAsset,
        opsSummary,
      };
    });
  };

  const enqueueTelemetry = (samples: TelemetrySample[]) => {
    if (samples.length === 0) return;
    pendingTelemetry.push(...samples);
    if (telemetryFlushTimer == null) {
      telemetryFlushTimer = setTimeout(flushTelemetry, TELEMETRY_FLUSH_MS);
    }
  };

  /** Trailing debounce for WS-driven overview refreshes (keeps mutation awaits immediate). */
  const scheduleOverviewRefresh = () => {
    if (overviewRefreshTimer != null) clearTimeout(overviewRefreshTimer);
    overviewRefreshTimer = setTimeout(() => {
      overviewRefreshTimer = null;
      void get().refreshOverview();
    }, OVERVIEW_REFRESH_DEBOUNCE_MS);
  };

  return {
  assets: [],
  reviews: [],
  reviewDetails: {},
  assessmentsByReview: {},
    taskEventSeq: 0,
    boardEventSeq: 0,
    commentEventSeq: 0,
    lastCommentReviewId: null,
  notifications: [],
  unreadNotificationIds: [],
  agentStepsByReview: {},
  telemetrySeries: {},
  telemetryLatest: {},
  telemetryBySource: {},
  telemetryStatus: [],
  selectedAssetId: null,
  assetPanelMode: "summary",
  domainFocusRequest: null,
  thresholdsConfig: DEFAULT_THRESHOLDS,
  sensorCriticalByAsset: {},
  opsChipsByAsset: {},
  opsSummary: EMPTY_OPS_SUMMARY,
  bootstrapped: false,
  loading: false,
  error: null,

  selectAsset: (id) =>
    set({
      selectedAssetId: id,
      assetPanelMode: "summary",
      domainFocusRequest: null,
    }),

  setAssetPanelMode: (mode) => set({ assetPanelMode: mode }),

  openAssetFullReview: (assetId) =>
    set({
      selectedAssetId: assetId,
      assetPanelMode: "fullReview",
      domainFocusRequest: null,
    }),

  openAssetDomain: (assetId, domain) =>
    set({
      selectedAssetId: assetId,
      assetPanelMode: "summary",
      domainFocusRequest: { assetId, domain, nonce: Date.now() },
    }),

  clearDomainFocusRequest: () => set({ domainFocusRequest: null }),

  bootstrap: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [assets, reviews, notifications, telemetry, thresholdsConfig] =
        await Promise.all([
        fetchAssets(),
        fetchReviews(),
        fetchNotifications(),
        fetchRecentTelemetry({ per_asset: TELEMETRY_RING_CAP }).catch(
          () => ({ samples: [], count: 0 }),
        ),
        fetchThresholds().catch(() => DEFAULT_THRESHOLDS),
      ]);
      const hydrated = applyTelemetrySamples(
        {
          telemetrySeries: {},
          telemetryLatest: {},
          telemetryBySource: {},
          telemetryStatus: [],
        },
        telemetry.samples.map((s) => ({
          source: s.source,
          asset_id: s.asset_id,
          asset_name: s.asset_name ?? undefined,
          category: s.category,
          payload: s.payload,
          ts: s.ts,
          mode: s.mode,
        })),
      );
      set({
        assets,
        reviews,
        notifications,
        // Existing history should not flood the badge / banners.
        unreadNotificationIds: [],
        reviewDetails: {},
        assessmentsByReview: {},
        selectedAssetId: null,
        assetPanelMode: "summary",
        ...hydrated,
        thresholdsConfig,
        sensorCriticalByAsset: buildSensorCriticalMap(assets, {
          ...hydrated,
          thresholdsConfig,
          reviews,
          reviewDetails: {},
        }),
        ...(() => {
          const opsChipsByAsset = refreshOpsChipsByAsset(
            {},
            hydrated.telemetryStatus,
            hydrated.telemetryBySource,
          );
          return {
            opsChipsByAsset,
            opsSummary: refreshOpsSummary(EMPTY_OPS_SUMMARY, opsChipsByAsset),
          };
        })(),
        bootstrapped: true,
        loading: false,
        error: null,
      });

      const active = reviews.filter((r) => r.state !== "closed").slice(0, 12);
      for (let i = 0; i < active.length; i += 3) {
        const chunk = active.slice(i, i + 3);
        await Promise.all(
          chunk.map(async (r) => {
            try {
              await get().loadReviewDetail(r.id);
            } catch {
              /* best-effort */
            }
          }),
        );
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  refreshOverview: async () => {
    try {
      const reviews = await fetchReviews();
      set({ reviews });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setThresholdsConfig: (config) => {
    const state = get();
    set({
      thresholdsConfig: config,
      sensorCriticalByAsset: buildSensorCriticalMap(state.assets, {
        ...state,
        thresholdsConfig: config,
      }),
    });
  },

  refreshThresholds: async () => {
    try {
      const config = await fetchThresholds();
      get().setThresholdsConfig(config);
      return config;
    } catch {
      const fallback = DEFAULT_THRESHOLDS;
      get().setThresholdsConfig(fallback);
      return fallback;
    }
  },

  loadNotifications: async () => {
    try {
      const notifications = await fetchNotifications();
      const existing = new Set(get().notifications.map((n) => n.id));
      const incomingUnread = isDndEnabled()
        ? []
        : notifications
            .filter((n) => !existing.has(n.id) && isAlertNotification(n))
            .map((n) => n.id);
      set((state) => ({
        notifications,
        unreadNotificationIds: [
          ...incomingUnread,
          ...state.unreadNotificationIds.filter((id) =>
            notifications.some((n) => n.id === id),
          ),
        ],
      }));
    } catch {
      /* best-effort */
    }
  },

  dismissNotification: (id) => {
    const existing = get().notifications.find((n) => n.id === id);
    if (existing) dismissNotificationToast(existing);
    else dismissNotificationToast(id);
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
      unreadNotificationIds: state.unreadNotificationIds.filter((x) => x !== id),
    }));
  },

  clearNotifications: () => {
    dismissAllNotificationToasts();
    set({
      notifications: [],
      unreadNotificationIds: [],
    });
  },

  markNotificationsRead: () => {
    set({ unreadNotificationIds: [] });
  },

  clearAgentSteps: () => {
    set({ agentStepsByReview: {} });
  },

  clearTelemetry: () => {
    pendingTelemetry.length = 0;
    if (telemetryFlushTimer != null) {
      clearTimeout(telemetryFlushTimer);
      telemetryFlushTimer = null;
    }
    set({
      telemetrySeries: {},
      telemetryLatest: {},
      telemetryBySource: {},
      telemetryStatus: [],
      sensorCriticalByAsset: {},
      opsChipsByAsset: {},
      opsSummary: EMPTY_OPS_SUMMARY,
    });
  },

  loadReviewDetail: async (id: string) => {
    const [detail, assessments] = await Promise.all([
      fetchReviewDetail(id),
      fetchReviewAssessments(id),
    ]);
    set((state) => {
      const reviewDetails = { ...state.reviewDetails, [id]: detail };
      const assessmentsByReview = {
        ...state.assessmentsByReview,
        [id]: assessments,
      };
      const merged = { ...state, reviewDetails, assessmentsByReview };
      return {
        reviewDetails,
        assessmentsByReview,
        sensorCriticalByAsset: patchSensorCriticalForAssets(
          state.sensorCriticalByAsset,
          merged,
          [detail.asset.id],
        ),
      };
    });
  },

  submitDecision: async (id, body) => {
    const decision = await postDecision(id, body);
    await get().loadReviewDetail(id);
    await get().refreshOverview();
    return decision;
  },

  closeReview: async (id) => {
    const review = await postCloseReview(id);
    await get().loadReviewDetail(id);
    await get().refreshOverview();
    return review;
  },

  reopenReview: async (id, reason = "") => {
    const review = await postReopenReview(id, reason);
    await get().loadReviewDetail(id);
    await get().refreshOverview();
    return review;
  },

  retryAssessment: async (id, provider) => {
    await postRetryAssessment(id, provider);
    await get().loadReviewDetail(id);
    await get().refreshOverview();
  },

  submitManualAssessment: async (id, body) => {
    const assessment = await postManualAssessment(id, body);
    await get().loadReviewDetail(id);
    await get().refreshOverview();
    return assessment;
  },

  handleRealtimeEvent: (type, payload) => {
    if (type.startsWith("task.")) {
      const reviewId =
        typeof payload.review_id === "string" ? payload.review_id : null;
      set((state) => ({
        taskEventSeq: state.taskEventSeq + 1,
        boardEventSeq: state.boardEventSeq + 1,
      }));
      if (reviewId) {
        void get().loadReviewDetail(reviewId).catch(() => {});
      }
      return;
    }

    if (
      type === "review.status_changed" ||
      type === "decision.submitted" ||
      type === "assessment.completed" ||
      type === "assessment.failed"
    ) {
      set((state) => ({ boardEventSeq: state.boardEventSeq + 1 }));
    }

    if (type === "comment.created") {
      const rid =
        typeof payload.review_id === "string" ? (payload.review_id as string) : null;
      set((state) => ({
        commentEventSeq: state.commentEventSeq + 1,
        lastCommentReviewId: rid,
      }));
      return;
    }
    if (type === "agent.step") {
      const step = asAgentStep(payload);
      if (step) {
        set((state) => ({
          agentStepsByReview: appendAgentStep(state.agentStepsByReview, step),
        }));
      }
      return;
    }

    if (type === "telemetry.sample") {
      const sample = asTelemetrySample(payload);
      if (sample) enqueueTelemetry([sample]);
      return;
    }

    if (type === "telemetry.batch") {
      const raw = payload.samples;
      if (!Array.isArray(raw)) return;
      const samples: TelemetrySample[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const sample = asTelemetrySample(item as Record<string, unknown>);
        if (sample) samples.push(sample);
      }
      enqueueTelemetry(samples);
      return;
    }

    if (type === "sim.source_emit" || type === "sim.orchestrator") {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : `${type} event`;
      const source =
        typeof payload.source === "string" ? payload.source : "sim";
      const step: AgentStepEvent = {
        id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        agent: type === "sim.orchestrator" ? "sim_orchestrator" : `sim_${source}`,
        kind: type === "sim.orchestrator" ? "started" : "tool_call",
        message,
        review_id:
          typeof payload.review_id === "string" ? payload.review_id : null,
        assessment_id: null,
        finding: "neutral",
        detail: payload,
        ts: new Date().toISOString(),
      };
      set((state) => {
        const next: Partial<LiveState> = {
          agentStepsByReview: appendAgentStep(state.agentStepsByReview, step),
        };
        if (type === "sim.source_emit") {
          const sample = asTelemetrySample(payload);
          if (sample) {
            Object.assign(next, applyTelemetrySamples(state, [sample]));
          }
        }
        return next;
      });
      if (type === "sim.source_emit") {
        scheduleOverviewRefresh();
      }
      return;
    }

    const reviewId =
      typeof payload.review_id === "string" ? payload.review_id : null;
    scheduleOverviewRefresh();
    if (
      reviewId &&
      (type === "review.status_changed" ||
        type === "assessment.completed" ||
        type === "assessment.failed" ||
        type === "decision.submitted" ||
        type === "report.generated")
    ) {
      void get().loadReviewDetail(reviewId).catch(() => {});
    }
    if (
      !isDndEnabled() &&
      type === "review.status_changed" &&
      reviewId &&
      payload.state === "assessing" &&
      typeof payload.previous_state === "string"
    ) {
      showReassessmentToast({
        reviewId,
        previousState: payload.previous_state,
        onOpen: () => {
          void focusReviewAssetOnTwin(reviewId);
        },
      });
    }
    if (type === "notification.created") {
      const n = asNotification(payload);
      if (n) {
        set((state) => {
          const notifications = [
            n,
            ...state.notifications.filter((x) => x.id !== n.id),
          ].slice(0, NOTIFICATION_CAP);
          const unreadNotificationIds =
            !isDndEnabled() && isAlertNotification(n)
              ? [n.id, ...state.unreadNotificationIds.filter((x) => x !== n.id)]
              : state.unreadNotificationIds.filter((x) => x !== n.id);
          return {
            notifications,
            unreadNotificationIds,
          };
        });
        if (!isDndEnabled() && presentNotification(n).toastable) {
          showNotificationToast(n, {
            onClear: () => get().dismissNotification(n.id),
            onOpen: n.review_id
              ? () => {
                  void focusReviewAssetOnTwin(n.review_id!);
                }
              : undefined,
          });
        }
      }
    }
  },
  };
});

export function telemetryRingKey(assetId: string, metric: string): string {
  return ringKey(assetId, metric);
}

export function getAssetMetricSeries(
  series: Record<string, TelemetryPoint[]>,
  assetId: string,
  metric: TelemetryMetricKey,
): TelemetryPoint[] {
  return series[ringKey(assetId, metric)] ?? [];
}

export function getLiveAssetViews(
  state: Pick<
    LiveState,
    | "assets"
    | "reviews"
    | "reviewDetails"
    | "assessmentsByReview"
    | "sensorCriticalByAsset"
  >,
): LiveAssetView[] {
  const reviewsByAsset = new Map<string, Review>();
  for (const r of state.reviews) {
    const prev = reviewsByAsset.get(r.asset_id);
    if (!prev || prev.created_at < r.created_at) {
      reviewsByAsset.set(r.asset_id, r);
    }
  }

  return state.assets.map((asset) => {
    const review = reviewsByAsset.get(asset.id) ?? null;
    const assessments = review
      ? state.assessmentsByReview[review.id]
      : undefined;
    const assessment = latestComplete(assessments);
    const detail = review ? state.reviewDetails[review.id] ?? null : null;
    return {
      asset,
      review,
      assessment,
      detail,
      risk_level: deriveRisk(review, assessment, detail),
      sensor_critical: state.sensorCriticalByAsset[asset.id] ?? false,
    };
  });
}

/** Stable empty array when a review has no live steps yet. */
export function selectAgentStepsForReview(reviewId: string) {
  return (state: Pick<LiveState, "agentStepsByReview">): AgentStepEvent[] =>
    state.agentStepsByReview[reviewId] ?? EMPTY_AGENT_STEPS;
}

export function useAgentStepsForReview(reviewId: string): AgentStepEvent[] {
  return useLiveStore((s) => s.agentStepsByReview[reviewId] ?? EMPTY_AGENT_STEPS);
}

/**
 * Subscribe once to the four overview slices and memoize derived views.
 * Prefer this over calling getLiveAssetViews in every twin panel.
 */
export function useLiveAssetViews(): LiveAssetView[] {
  const assets = useLiveStore((s) => s.assets);
  const reviews = useLiveStore((s) => s.reviews);
  const reviewDetails = useLiveStore((s) => s.reviewDetails);
  const assessmentsByReview = useLiveStore((s) => s.assessmentsByReview);
  const sensorCriticalByAsset = useLiveStore((s) => s.sensorCriticalByAsset);
  return useMemo(
    () =>
      getLiveAssetViews({
        assets,
        reviews,
        reviewDetails,
        assessmentsByReview,
        sensorCriticalByAsset,
      }),
    [assets, reviews, reviewDetails, assessmentsByReview, sensorCriticalByAsset],
  );
}

export function useSensorCritical(assetId: string | null | undefined): boolean {
  return useLiveStore((s) =>
    assetId ? (s.sensorCriticalByAsset[assetId] ?? false) : false,
  );
}

export type AssetTelemetrySlice = {
  series: Record<TelemetryMetricKey, TelemetryPoint[] | undefined>;
  latest: TelemetrySample | undefined;
  status: TelemetryStatusChip[];
};

function assetTelemetryRevision(
  state: Pick<
    LiveState,
    "telemetrySeries" | "telemetryStatus" | "telemetryLatest"
  >,
  assetId: string,
): string {
  const metricSig = NUMERIC_METRICS.map((key) => {
    const pts = state.telemetrySeries[ringKey(assetId, key)];
    const last = pts?.[pts.length - 1];
    return last ? `${last.t}:${last.v}:${pts.length}` : `:${pts?.length ?? 0}`;
  }).join(";");
  const statusSig = state.telemetryStatus
    .filter((c) => c.asset_id === assetId)
    .map((c) => `${c.category}:${c.label}:${c.ts}`)
    .join("|");
  const latest = state.telemetryLatest[assetId];
  const latestSig = latest ? `${latest.ts}:${latest.category}` : "";
  return `${metricSig}|${statusSig}|${latestSig}`;
}

/** One subscription for all metric rings + status chips on an asset. */
export function useAssetTelemetrySlice(assetId: string): AssetTelemetrySlice {
  const revision = useLiveStore((s) => assetTelemetryRevision(s, assetId));
  return useMemo(() => {
    const s = useLiveStore.getState();
    const series = {} as Record<
      TelemetryMetricKey,
      TelemetryPoint[] | undefined
    >;
    for (const key of NUMERIC_METRICS) {
      series[key] = s.telemetrySeries[ringKey(assetId, key)];
    }
    return {
      series,
      latest: s.telemetryLatest[assetId],
      status: s.telemetryStatus.filter((c) => c.asset_id === assetId),
    };
  }, [assetId, revision]);
}

export function findViewByAssetId(
  views: LiveAssetView[],
  assetId: string,
): LiveAssetView | undefined {
  return views.find((v) => v.asset.id === assetId);
}

export function findViewByReviewId(
  state: Pick<
    LiveState,
    | "assets"
    | "reviews"
    | "reviewDetails"
    | "assessmentsByReview"
    | "sensorCriticalByAsset"
  >,
  reviewId: string,
): LiveAssetView | undefined {
  const review = state.reviews.find((r) => r.id === reviewId) ?? null;
  if (!review) return undefined;
  const asset = state.assets.find((a) => a.id === review.asset_id);
  if (!asset) return undefined;
  const assessments = state.assessmentsByReview[review.id];
  const assessment = latestComplete(assessments);
  const detail = state.reviewDetails[review.id] ?? null;
  return {
    asset,
    review,
    assessment,
    detail,
    risk_level: deriveRisk(review, assessment, detail),
    sensor_critical: state.sensorCriticalByAsset[asset.id] ?? false,
  };
}

/** Select the reviewed asset on the Digital Twin (summary panel, not full review). */
export async function focusReviewAssetOnTwin(
  reviewId: string,
): Promise<void> {
  const store = useLiveStore.getState();
  try {
    await store.loadReviewDetail(reviewId);
  } catch {
    /* best-effort — may already be in store */
  }
  const state = useLiveStore.getState();
  const view = findViewByReviewId(state, reviewId);
  if (view) {
    state.selectAsset(view.asset.id);
  }
}
