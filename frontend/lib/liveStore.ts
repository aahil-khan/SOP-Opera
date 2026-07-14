"use client";

import { create } from "zustand";
import type {
  Assessment,
  Asset,
  Decision,
  Review,
} from "@/shared/schemas";
import type { RiskLevel } from "@/shared/enums";
import {
  fetchAssets,
  fetchReviewAssessments,
  fetchReviewDetail,
  fetchReviews,
  postDecision,
  postManualAssessment,
  postRetryAssessment,
  type AssessmentHistoryItem,
  type DecisionIn,
  type ReviewDetail,
} from "@/lib/liveApi";
import type { ManualAssessmentIn } from "@/shared/schemas";

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
  selectedAssetId: string | null;
  bootstrapped: boolean;
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  refreshOverview: () => Promise<void>;
  loadReviewDetail: (id: string) => Promise<void>;
  submitDecision: (id: string, body: DecisionIn) => Promise<Decision>;
  retryAssessment: (
    id: string,
    provider?: "openai_compatible" | "ollama" | "mock" | null,
  ) => Promise<void>;
  submitManualAssessment: (
    id: string,
    body: ManualAssessmentIn,
  ) => Promise<Assessment>;
  selectAsset: (id: string | null) => void;
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

export const useLiveStore = create<LiveState>((set, get) => ({
  assets: [],
  reviews: [],
  reviewDetails: {},
  assessmentsByReview: {},
  selectedAssetId: null,
  bootstrapped: false,
  loading: false,
  error: null,

  selectAsset: (id) => set({ selectedAssetId: id }),

  bootstrap: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [assets, reviews] = await Promise.all([
        fetchAssets(),
        fetchReviews(),
      ]);
      set({ assets, reviews, bootstrapped: true, loading: false });

      // Prefetch detail for active (non-closed) reviews so risk highlights work.
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
        type === "decision.submitted")
    ) {
      void get().loadReviewDetail(reviewId).catch(() => {});
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
