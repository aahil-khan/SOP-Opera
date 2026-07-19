"use client";

import { create } from "zustand";
import type {
  Assessment,
  Asset,
  Decision,
  Notification,
  Review,
} from "@/shared/schemas";
import type { RiskLevel } from "@/shared/enums";
import {
  fetchAssets,
  fetchNotifications,
  fetchReviewAssessments,
  fetchReviewDetail,
  fetchReviews,
  postCloseReview,
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
} from "@/lib/notificationToast";
import { presentNotification } from "@/lib/notificationPresentation";

const NOTIFICATION_CAP = 50;
const AGENT_STEP_CAP = 100;
const TELEMETRY_RING_CAP = 30;
/** Coalesce rapid soft samples into one Zustand write. */
const TELEMETRY_FLUSH_MS = 250;


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
    ].slice(0, 24);
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

export interface AgentStepEvent {
  id: string;
  agent: string;
  kind: AgentStepKind;
  message: string;
  review_id: string | null;
  assessment_id: string | null;
  detail: Record<string, unknown>;
  ts: string;
}

export interface SpatialLinkView {
  from_asset_id: string;
  to_asset_id: string;
  from_label: string;
  to_label: string;
  relation: string;
  distance_m: number;
  floors_apart: number;
  reason: string;
}

export interface LiveAssetView {
  asset: Asset;
  risk_level: RiskLevel;
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
  /** Client-side unread ids (bootstrap history starts as read). */
  unreadNotificationIds: string[];
  agentSteps: AgentStepEvent[];
  telemetrySeries: Record<string, TelemetryPoint[]>;
  telemetryLatest: Record<string, TelemetrySample>;
  telemetryBySource: Record<string, TelemetrySample>;
  telemetryStatus: TelemetryStatusChip[];
  selectedAssetId: string | null;
  bootstrapped: boolean;
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  refreshOverview: () => Promise<void>;
  loadReviewDetail: (id: string) => Promise<void>;
  submitDecision: (id: string, body: DecisionIn) => Promise<Decision>;
  closeReview: (id: string) => Promise<Review>;
  retryAssessment: (
    id: string,
    provider?: "openai_compatible" | "ollama" | "mock" | null,
  ) => Promise<void>;
  submitManualAssessment: (
    id: string,
    body: ManualAssessmentIn,
  ) => Promise<Assessment>;
  selectAsset: (id: string | null) => void;
  loadNotifications: () => Promise<void>;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  markNotificationsRead: () => void;
  clearAgentSteps: () => void;
  clearTelemetry: () => void;
  handleRealtimeEvent: (type: string, payload: Record<string, unknown>) => void;
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

function deriveRisk(
  review: Review | null,
  assessment: AssessmentHistoryItem | null,
  detail: ReviewDetail | null,
): RiskLevel {
  if (assessment?.status === "complete" && assessment.risk_level) {
    return assessment.risk_level;
  }
  if (detail?.derived_facts?.some((f) => f.value === true || f.value === "true")) {
    return "elevated";
  }
  if (review && review.state !== "closed") {
    return "elevated";
  }
  return "nominal";
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
  return {
    id: `${payload.agent}-${payload.ts ?? Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    agent: payload.agent,
    kind: kind as AgentStepKind,
    message: payload.message,
    review_id: typeof payload.review_id === "string" ? payload.review_id : null,
    assessment_id:
      typeof payload.assessment_id === "string" ? payload.assessment_id : null,
    detail:
      payload.detail && typeof payload.detail === "object"
        ? (payload.detail as Record<string, unknown>)
        : {},
    ts:
      typeof payload.ts === "string" ? payload.ts : new Date().toISOString(),
  };
}

export function spatialLinksFromAssessment(
  assessment: AssessmentHistoryItem | null | undefined,
): SpatialLinkView[] {
  if (!assessment) return [];
  const trace =
    (assessment as AssessmentHistoryItem & { agent_trace?: unknown[] }).agent_trace ??
    (assessment.metadata as { agent_trace?: unknown[] } | null)?.agent_trace ??
    [];
  if (!Array.isArray(trace)) return [];
  const links: SpatialLinkView[] = [];
  const seen = new Set<string>();
  for (const raw of trace) {
    if (!raw || typeof raw !== "object") continue;
    const step = raw as Record<string, unknown>;
    const detail =
      step.detail && typeof step.detail === "object"
        ? (step.detail as Record<string, unknown>)
        : {};
    const arr = detail.spatial_links;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const L = item as Record<string, unknown>;
      const key = `${L.from_asset_id}-${L.to_asset_id}-${L.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        from_asset_id: String(L.from_asset_id ?? ""),
        to_asset_id: String(L.to_asset_id ?? ""),
        from_label: String(L.from_label ?? L.from_asset_id ?? ""),
        to_label: String(L.to_label ?? L.to_asset_id ?? ""),
        relation: String(L.relation ?? "NEAR"),
        distance_m: Number(L.distance_m ?? 0),
        floors_apart: Number(L.floors_apart ?? 0),
        reason: String(L.reason ?? ""),
      });
    }
  }
  return links;
}

export const useLiveStore = create<LiveState>((set, get) => {
  const pendingTelemetry: TelemetrySample[] = [];
  let telemetryFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const flushTelemetry = () => {
    telemetryFlushTimer = null;
    if (pendingTelemetry.length === 0) return;
    const batch = pendingTelemetry.splice(0, pendingTelemetry.length);
    set((state) => applyTelemetrySamples(state, batch));
  };

  const enqueueTelemetry = (samples: TelemetrySample[]) => {
    if (samples.length === 0) return;
    pendingTelemetry.push(...samples);
    if (telemetryFlushTimer == null) {
      telemetryFlushTimer = setTimeout(flushTelemetry, TELEMETRY_FLUSH_MS);
    }
  };

  return {
  assets: [],
  reviews: [],
  reviewDetails: {},
  assessmentsByReview: {},
  notifications: [],
  unreadNotificationIds: [],
  agentSteps: [],
  telemetrySeries: {},
  telemetryLatest: {},
  telemetryBySource: {},
  telemetryStatus: [],
  selectedAssetId: null,
  bootstrapped: false,
  loading: false,
  error: null,

  selectAsset: (id) => set({ selectedAssetId: id }),

  bootstrap: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [assets, reviews, notifications] = await Promise.all([
        fetchAssets(),
        fetchReviews(),
        fetchNotifications(),
      ]);
      set({
        assets,
        reviews,
        notifications,
        // Existing history should not flood the badge / banners.
        unreadNotificationIds: [],
        reviewDetails: {},
        assessmentsByReview: {},
        selectedAssetId: null,
        bootstrapped: true,
        loading: false,
        error: null,
      });

      const active = reviews.filter((r) => r.state !== "closed");
      await Promise.all(
        active.slice(0, 12).map(async (r) => {
          try {
            await get().loadReviewDetail(r.id);
          } catch {
            /* best-effort */
          }
        }),
      );
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

  loadNotifications: async () => {
    try {
      const notifications = await fetchNotifications();
      const existing = new Set(get().notifications.map((n) => n.id));
      const incomingUnread = notifications
        .filter((n) => !existing.has(n.id))
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
    set({ agentSteps: [] });
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
    });
  },

  loadReviewDetail: async (id: string) => {
    const [detail, assessments] = await Promise.all([
      fetchReviewDetail(id),
      fetchReviewAssessments(id),
    ]);
    set((state) => ({
      reviewDetails: { ...state.reviewDetails, [id]: detail },
      assessmentsByReview: {
        ...state.assessmentsByReview,
        [id]: assessments,
      },
    }));
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
    if (type === "agent.step") {
      const step = asAgentStep(payload);
      if (step) {
        set((state) => ({
          agentSteps: [...state.agentSteps, step].slice(-AGENT_STEP_CAP),
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
        detail: payload,
        ts: new Date().toISOString(),
      };
      set((state) => {
        const next: Partial<LiveState> = {
          agentSteps: [...state.agentSteps, step].slice(-AGENT_STEP_CAP),
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
        void get().refreshOverview();
      }
      return;
    }

    const reviewId =
      typeof payload.review_id === "string" ? payload.review_id : null;
    void get().refreshOverview();
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
    if (type === "notification.created") {
      const n = asNotification(payload);
      if (n) {
        set((state) => {
          const notifications = [
            n,
            ...state.notifications.filter((x) => x.id !== n.id),
          ].slice(0, NOTIFICATION_CAP);
          const unreadNotificationIds = [
            n.id,
            ...state.unreadNotificationIds.filter((x) => x !== n.id),
          ];
          return {
            notifications,
            unreadNotificationIds,
          };
        });
        if (presentNotification(n).toastable) {
          showNotificationToast(n, {
            onClear: () => get().dismissNotification(n.id),
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
    "assets" | "reviews" | "reviewDetails" | "assessmentsByReview"
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
    };
  });
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
    "assets" | "reviews" | "reviewDetails" | "assessmentsByReview"
  >,
  reviewId: string,
): LiveAssetView | undefined {
  const views = getLiveAssetViews(state);
  return views.find((v) => v.review?.id === reviewId);
}
