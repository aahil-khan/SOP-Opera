"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  findViewByReviewId,
  useLiveStore,
} from "@/lib/liveStore";

/**
 * Deep links into a review open the Digital Twin with the asset selected
 * and the right panel in full-review mode — no separate review page.
 */
export default function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const bootstrapped = useLiveStore((s) => s.bootstrapped);
  const bootstrap = useLiveStore((s) => s.bootstrap);
  const loadReviewDetail = useLiveStore((s) => s.loadReviewDetail);
  const openAssetFullReview = useLiveStore((s) => s.openAssetFullReview);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!bootstrapped) {
      void bootstrap();
    }
  }, [bootstrapped, bootstrap]);

  useEffect(() => {
    if (!bootstrapped || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        await loadReviewDetail(id);
        if (cancelled) return;

        const state = useLiveStore.getState();
        const view = findViewByReviewId(
          {
            assets: state.assets,
            reviews: state.reviews,
            reviewDetails: state.reviewDetails,
            assessmentsByReview: state.assessmentsByReview,
          },
          id,
        );
        if (!view) {
          setError("Review not found for any asset.");
          return;
        }
        openAssetFullReview(view.asset.id);
        router.replace("/");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, bootstrapped, loadReviewDetail, openAssetFullReview, router]);

  if (error) {
    return (
      <div style={{ padding: "2rem", color: "var(--text-muted)" }}>
        <p>Could not open review: {error}</p>
        <a href="/">← Back to Digital Twin</a>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", color: "var(--text-muted)" }}>
      Opening review on Digital Twin…
    </div>
  );
}
