"use client";

/**
 * The "speech bubble": act intertitle → title → narration, plus the controls.
 * Swaps to a step's `fallbackBody` when the backend never started the scenario,
 * so Acts II–III read honestly instead of promising live agents that aren't there.
 */

import { TOUR_STEPS, type TourStep } from "@/lib/tourScript";
import { useTourStore } from "@/lib/tourStore";
import { TourControls } from "./TourControls";
import styles from "./NarrationCard.module.css";

interface NarrationCardProps {
  step: TourStep;
  stepIndex: number;
}

export function NarrationCard({ step, stepIndex }: NarrationCardProps) {
  const fallbackScripted = useTourStore((s) => s.fallbackScripted);
  const body =
    fallbackScripted && step.fallbackBody ? step.fallbackBody : step.body;

  return (
    <div className={styles.card} key={step.id}>
      <div className={styles.masthead}>
        <span className={styles.mask} aria-hidden="true">
          🎭
        </span>
        <span className={styles.act}>{step.act}</span>
      </div>
      <h2 className={styles.title}>{step.title}</h2>
      <p className={styles.body}>{body}</p>
      <TourControls stepIndex={stepIndex} total={TOUR_STEPS.length} />
    </div>
  );
}
