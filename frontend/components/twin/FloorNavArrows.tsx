"use client";

import styles from "./FloorNavArrows.module.css";

interface FloorNavArrowsProps {
  canGoPrev: boolean;
  canGoNext: boolean;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  shiftForDrawer?: boolean;
}

export function FloorNavArrows({
  canGoPrev,
  canGoNext,
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  shiftForDrawer = false,
}: FloorNavArrowsProps) {
  return (
    <>
      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowLeft}`}
        onClick={onPrev}
        disabled={!canGoPrev}
        aria-label={`Previous floor: ${prevLabel}`}
        title={prevLabel}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path
            d="M11.25 3.75 6 9l5.25 5.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.arrow} ${styles.arrowRight}`}
        data-shift={shiftForDrawer ? "true" : undefined}
        onClick={onNext}
        disabled={!canGoNext}
        aria-label={`Next floor: ${nextLabel}`}
        title={nextLabel}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <path
            d="M6.75 3.75 12 9l-5.25 5.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  );
}
