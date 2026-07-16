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

export const useLiveStore = create<LiveState>((set, get) => ({
  assets: [],
  reviews: [],
  reviewDetails: {},
  assessmentsByReview: {},
  notifications: [],
  unreadNotificationIds: [],
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
}));

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
