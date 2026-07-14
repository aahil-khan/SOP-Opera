"use client";

import type { ReactNode } from "react";
import styles from "./TraceNode.module.css";

interface TraceNodeProps {
  label: string;
  filled?: boolean;
  children: ReactNode;
}

export function TraceNode({ label, filled = true, children }: TraceNodeProps) {
  return (
    <div className={styles.node}>
      <span className={styles.dot} data-filled={filled} aria-hidden />
      <p className={styles.label}>{label}</p>
      <div className={styles.body}>{children}</div>
    </div>
  );
}

export function TraceChip({
  children,
  strong,
}: {
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <span className={`${styles.chip} ${strong ? styles.chipStrong : ""}`}>
      {children}
    </span>
  );
}

export { styles as traceNodeStyles };
