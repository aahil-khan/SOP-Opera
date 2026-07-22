"use client";

import type { ReactNode, Ref } from "react";
import styles from "./DecisionCard.module.css";

interface DecisionCardProps {
  title: string;
  children: ReactNode;
  /** When provided, shows a close control in the header. */
  onClose?: () => void;
  /** Marks the exit animation for mount/unmount in the AssetPanel drawer. */
  closing?: boolean;
  cardRef?: Ref<HTMLDivElement>;
}

/**
 * Shared chrome for decision UI — used by AssetPanel quick-decision
 * and ReviewDetail full-review Decision section.
 */
export function DecisionCard({
  title,
  children,
  onClose,
  closing = false,
  cardRef,
}: DecisionCardProps) {
  return (
    <div
      ref={cardRef}
      className={styles.card}
      data-closing={closing ? "true" : undefined}
      role="region"
      aria-label={title}
    >
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {onClose ? (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close decision"
          >
            ×
          </button>
        ) : null}
      </header>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
