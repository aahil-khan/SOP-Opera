"use client";

import { useEffect, useRef } from "react";
import {
  playNewReviewChime,
  unlockReviewChime,
} from "@/lib/reviewChime";

/**
 * Primes known review ids on mount (no sound), then chimes once whenever a
 * new review id appears. Also unlocks Web Audio on the first user gesture.
 */
export function useNewReviewChime(reviewIds: string[]): void {
  const primedRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const idKey = reviewIds.join("\0");

  useEffect(() => {
    const unlock = () => unlockReviewChime();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!primedRef.current) {
      seenRef.current = new Set(reviewIds);
      primedRef.current = true;
      return;
    }
    let added = false;
    for (const id of reviewIds) {
      if (!seenRef.current.has(id)) {
        seenRef.current.add(id);
        added = true;
      }
    }
    if (added) playNewReviewChime();
  }, [idKey, reviewIds]);
}
