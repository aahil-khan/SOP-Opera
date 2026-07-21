"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { EASE_OUT } from "@/lib/motion";

/** cubic-bezier(0.22, 1, 0.36, 1) evaluated for y given x, via bisection. */
function easeOutAt(t: number): number {
  const [, y1, , y2] = EASE_OUT;
  // Cubic bezier with p0=(0,0), p3=(1,1); x1=0.22, x2=0.36.
  const bezier = (a: number, b: number, u: number) =>
    3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezier(0.22, 0.36, mid) < t) lo = mid;
    else hi = mid;
  }
  return bezier(y1, y2, (lo + hi) / 2);
}

/**
 * Counts from 0 to `to` when scrolled into view. Renders the final value
 * immediately under reduced motion.
 */
export function CountUp({
  to,
  decimals = 0,
  durationMs = 1100,
}: {
  to: number;
  decimals?: number;
  durationMs?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setValue(to);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(to * easeOutAt(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, to, durationMs]);

  return (
    <span ref={ref}>
      {value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </span>
  );
}
