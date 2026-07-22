"use client";

/**
 * The "speech bubble": act intertitle → title → narration, plus the controls.
 * Swaps to a step's `fallbackBody` when the backend never started the scenario,
 * so Acts II–III read honestly instead of promising live agents that aren't there.
 * On an interactive step it also shows a "your turn" prompt for the real gesture.
 */

import { TOUR_STEPS, type TourStep } from "@/lib/tourScript";
import { useTourStore } from "@/lib/tourStore";
import { TourControls } from "./TourControls";
import styles from "./NarrationCard.module.css";

interface NarrationCardProps {
  step: TourStep;
  stepIndex: number;
  /** This step is a hands-on "your turn" beat in interactive mode. */
  interactive?: boolean;
  /** Gesture completes the step — Next reads as "Skip step". */
  awaitingGesture?: boolean;
}

export function NarrationCard({
  step,
  stepIndex,
  interactive = false,
  awaitingGesture = false,
}: NarrationCardProps) {
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
      {interactive && step.interactive ? (
        <div className={styles.yourTurn}>
          <span className={styles.yourTurnBadge}>Your turn</span>
          <span className={styles.yourTurnHint}>{step.interactive.hint}</span>
        </div>
      ) : null}
      <TourControls
        stepIndex={stepIndex}
        total={TOUR_STEPS.length}
        interactive={awaitingGesture}
      />
    </div>
  );
}
