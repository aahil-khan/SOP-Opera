"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { DigitalTwin } from "@/components/twin/DigitalTwin";
import {
  findViewByReviewId,
  useLiveStore,
} from "@/lib/liveStore";

/**
 * Deep links (`?review=`) select the asset and open full-review on the twin.
 * There is no standalone /reviews/[id] page.
 */
export default function OperatorDashboardPage() {
  const router = useRouter();
  const bootstrapped = useLiveStore((s) => s.bootstrapped);
  const bootstrap = useLiveStore((s) => s.bootstrap);
  const loadReviewDetail = useLiveStore((s) => s.loadReviewDetail);
  const openAssetFullReview = useLiveStore((s) => s.openAssetFullReview);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!bootstrapped) {
      void bootstrap();
    }
  }, [bootstrapped, bootstrap]);

  useEffect(() => {
    if (!bootstrapped || startedRef.current) return;
    const reviewId = new URLSearchParams(window.location.search).get("review");
    if (!reviewId) return;
    startedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        await loadReviewDetail(reviewId);
        if (cancelled) return;
        const state = useLiveStore.getState();
        const view = findViewByReviewId(
          {
            assets: state.assets,
            reviews: state.reviews,
            reviewDetails: state.reviewDetails,
            assessmentsByReview: state.assessmentsByReview,
            sensorCriticalByAsset: state.sensorCriticalByAsset,
          },
          reviewId,
        );
        if (view) {
          openAssetFullReview(view.asset.id);
        }
      } finally {
        if (!cancelled) {
          router.replace("/operator", { scroll: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, loadReviewDetail, openAssetFullReview, router]);

  return <DigitalTwin />;
}
