"use client";

import { create } from "zustand";
import type { Decision } from "@/shared/schemas";
import type {
  DecisionOutcome,
  RecommendationDisposition,
} from "@/shared/enums";
import {
  applySeedReview,
  buildBaselineRuntimes,
  DEMO_RAISED_REVIEWS,
  DEMO_SHARED_REVIEWS,
  DEMO_SUPERVISOR_TASKS,
  SCENARIOS,
  type AssetRuntime,
  type ScenarioName,
} from "./mockData";

export {
  DEMO_RAISED_REVIEWS,
  DEMO_SHARED_REVIEWS,
  DEMO_SUPERVISOR_TASKS,
};

const SUPERVISOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

interface DemoState {
  runtimes: Record<string, AssetRuntime>;
  selectedAssetId: string | null;
  activeScenario: ScenarioName | null;
  isPlaying: boolean;
  selectAsset: (id: string | null) => void;
  startScenario: (name: ScenarioName) => void;
  reset: () => void;
  submitDecision: (
    reviewId: string,
    outcome: DecisionOutcome,
    dispositions: Record<string, "accepted" | "rejected">,
    conditions: string | null,
  ) => void;
}

let playTimer: ReturnType<typeof setTimeout> | null = null;
const timers: ReturnType<typeof setTimeout>[] = [];

function clearTimers() {
  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = null;
  }
  while (timers.length) {
    const t = timers.pop();
    if (t) clearTimeout(t);
  }
}

function initialRuntimes(): Record<string, AssetRuntime> {
  return applySeedReview(buildBaselineRuntimes());
}

export const useDemoStore = create<DemoState>((set, get) => ({
  runtimes: initialRuntimes(),
  selectedAssetId: null,
  activeScenario: null,
  isPlaying: false,

  selectAsset: (id) => set({ selectedAssetId: id }),

  reset: () => {
    clearTimers();
    set({
      runtimes: initialRuntimes(),
      selectedAssetId: null,
      activeScenario: null,
      isPlaying: false,
    });
  },

  startScenario: (name) => {
    clearTimers();
    const steps = SCENARIOS[name];
    if (!steps.length) return;

    // Reset to clean baseline, then play
    set({
      runtimes: buildBaselineRuntimes(),
      activeScenario: name,
      isPlaying: true,
      selectedAssetId: steps[0].asset_id,
    });

    let elapsed = 0;
    steps.forEach((step, index) => {
      elapsed += step.delay_ms;
      const t = setTimeout(() => {
        set((state) => {
          const prev = state.runtimes[step.asset_id];
          if (!prev) return state;
          const updated: AssetRuntime = {
            ...prev,
            risk_level: step.risk_level,
            context: step.context ?? prev.context,
            derived_facts: step.derived_facts ?? prev.derived_facts,
            references: step.references ?? prev.references,
            review: step.review ?? prev.review,
            assessment:
              step.assessment !== undefined ? step.assessment : prev.assessment,
            decision: step.decision !== undefined ? step.decision : prev.decision,
          };
          return {
            runtimes: { ...state.runtimes, [step.asset_id]: updated },
            isPlaying: index < steps.length - 1,
            selectedAssetId: step.asset_id,
          };
        });
      }, elapsed);
      timers.push(t);
    });
  },

  submitDecision: (reviewId, outcome, dispositions, conditions) => {
    const { runtimes } = get();
    const entry = Object.entries(runtimes).find(
      ([, r]) => r.review?.id === reviewId,
    );
    if (!entry) return;
    const [assetId, runtime] = entry;
    if (!runtime.review || !runtime.assessment) return;

    const decision: Decision = {
      id: `dec-${Date.now()}`,
      review_id: reviewId,
      assessment_id: runtime.assessment.id,
      decided_by: SUPERVISOR,
      outcome,
      recommendation_dispositions: dispositions,
      conditions,
      comments: null,
      submitted_at: new Date().toISOString(),
    };

    const recommendations = runtime.assessment.recommendations.map((rec) => ({
      ...rec,
      disposition: (dispositions[rec.id] ??
        rec.disposition) as RecommendationDisposition | null,
    }));

    set({
      runtimes: {
        ...runtimes,
        [assetId]: {
          ...runtime,
          review: { ...runtime.review, state: "decided" },
          assessment: { ...runtime.assessment, recommendations },
          decision,
        },
      },
    });
  },
}));

export function getReviewsFromRuntimes(
  runtimes: Record<string, AssetRuntime>,
): AssetRuntime[] {
  return Object.values(runtimes).filter((r) => r.review != null);
}

export function findRuntimeByReviewId(
  runtimes: Record<string, AssetRuntime>,
  reviewId: string,
): AssetRuntime | undefined {
  return Object.values(runtimes).find((r) => r.review?.id === reviewId);
}
