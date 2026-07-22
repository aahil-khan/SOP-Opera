"use client";

/**
 * Tour transport: mode toggle (▶ Auto ⇄ ⏸ Interactive), Start over / Next,
 * Skip, and a progress rail. In auto mode a bar animates each step's dwell so
 * the viewer (and a demo audience) can see the pacing; pausing freezes it.
 */

import { DEFAULT_DWELL, TOUR_STEPS } from "@/lib/tourScript";
import { useLiveStore } from "@/lib/liveStore";
import { useTourStore } from "@/lib/tourStore";
import styles from "./TourControls.module.css";

interface TourControlsProps {
  stepIndex: number;
  total: number;
  /** Interactive step: the user is meant to act, so Next becomes "Skip step". */
  interactive?: boolean;
}

export function TourControls({
  stepIndex,
  total,
  interactive = false,
}: TourControlsProps) {
  const mode = useTourStore((s) => s.mode);
  const paused = useTourStore((s) => s.paused);
  const next = useTourStore((s) => s.next);
  const restart = useTourStore((s) => s.restart);
  const stop = useTourStore((s) => s.stop);
  const goTo = useTourStore((s) => s.goTo);
  const setMode = useTourStore((s) => s.setMode);
  const togglePause = useTourStore((s) => s.togglePause);

  const step = TOUR_STEPS[stepIndex];
  const nextReady = useLiveStore((s) =>
    step?.holdNextUntil ? step.holdNextUntil(s) : true,
  );

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;
  const autoRunning = mode === "auto" && !paused && nextReady;
  const dwell = step?.autoMs ?? DEFAULT_DWELL;

  return (
    <div className={styles.controls}>
      {mode === "auto" ? (
        <div className={styles.progressTrack} aria-hidden="true">
          <div
            key={`${stepIndex}-${paused}-${nextReady}`}
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
          onClick={restart}
          disabled={isFirst}
          title="Restart the tour from the beginning"
        >
          Start over
        </button>
        <button
          type="button"
          className={interactive ? styles.ghostBtn : styles.primaryBtn}
          onClick={next}
          disabled={!nextReady}
          aria-busy={!nextReady ? true : undefined}
        >
          {!nextReady
            ? "Wait for completion…"
            : isLast
              ? "Finish"
              : interactive
                ? "Skip step ›"
                : "Next"}
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
