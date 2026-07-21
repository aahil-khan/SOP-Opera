"use client";

/**
 * Tour transport: mode toggle (▶ Auto ⇄ ⏸ Interactive), Back / Next, Skip, and
 * a progress rail. In auto mode a bar animates each step's dwell so the viewer
 * (and a demo audience) can see the pacing; pausing freezes it.
 */

import { DEFAULT_DWELL, TOUR_STEPS } from "@/lib/tourScript";
import { useTourStore } from "@/lib/tourStore";
import styles from "./TourControls.module.css";

interface TourControlsProps {
  stepIndex: number;
  total: number;
}

export function TourControls({ stepIndex, total }: TourControlsProps) {
  const mode = useTourStore((s) => s.mode);
  const paused = useTourStore((s) => s.paused);
  const next = useTourStore((s) => s.next);
  const prev = useTourStore((s) => s.prev);
  const stop = useTourStore((s) => s.stop);
  const goTo = useTourStore((s) => s.goTo);
  const setMode = useTourStore((s) => s.setMode);
  const togglePause = useTourStore((s) => s.togglePause);

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;
  const autoRunning = mode === "auto" && !paused;
  const dwell = TOUR_STEPS[stepIndex]?.autoMs ?? DEFAULT_DWELL;

  return (
    <div className={styles.controls}>
      {mode === "auto" ? (
        <div className={styles.progressTrack} aria-hidden="true">
          <div
            key={`${stepIndex}-${paused}`}
            className={styles.progressFill}
            data-running={autoRunning ? "true" : undefined}
            style={{ animationDuration: `${dwell}ms` }}
          />
        </div>
      ) : null}

      <div className={styles.row}>
        <button
          type="button"
          className={styles.modeToggle}
          onClick={() => setMode(mode === "auto" ? "interactive" : "auto")}
          title={
            mode === "auto"
              ? "Switch to click-through"
              : "Switch to auto-play (demo)"
          }
        >
          {mode === "auto" ? "▶ Auto" : "⏸ Manual"}
        </button>

        {mode === "auto" ? (
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={togglePause}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        ) : null}

        <span className={styles.spacer} />

        <button
          type="button"
          className={styles.ghostBtn}
          onClick={prev}
          disabled={isFirst}
        >
          Back
        </button>
        <button type="button" className={styles.primaryBtn} onClick={next}>
          {isLast ? "Finish" : "Next"}
        </button>
      </div>

      <div className={styles.footer}>
        <div className={styles.dots} role="tablist" aria-label="Tour progress">
          {TOUR_STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={styles.dot}
              data-active={i === stepIndex ? "true" : undefined}
              data-done={i < stepIndex ? "true" : undefined}
              aria-label={`Go to ${s.act}: ${s.title}`}
              aria-selected={i === stepIndex}
              role="tab"
              onClick={() => goTo(i)}
            />
          ))}
        </div>
        <button type="button" className={styles.skip} onClick={stop}>
          Skip tour
        </button>
      </div>
    </div>
  );
}
