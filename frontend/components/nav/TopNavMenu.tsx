"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./TopNavMenu.module.css";

interface TopNavMenuProps {
  label: string;
  children: React.ReactNode;
  panelClassName?: string;
  onOpenChange?: (open: boolean) => void;
}

export function TopNavMenu({
  label,
  children,
  panelClassName,
  onOpenChange,
}: TopNavMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        data-open={open ? "true" : undefined}
      >
        <span>{label}</span>
        <svg
          className={styles.chevron}
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          data-open={open ? "true" : undefined}
        >
          <path
            d="M4.25 6.5 8 10.25 11.75 6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div
        id={panelId}
        className={`${styles.panel} ${panelClassName ?? ""}`}
        data-open={open ? "true" : "false"}
        aria-hidden={!open}
      >
        <div className={styles.panelInner}>{open ? children : null}</div>
      </div>
    </div>
  );
}
