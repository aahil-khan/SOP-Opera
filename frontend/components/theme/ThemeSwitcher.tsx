"use client";

import { useEffect, useId, useRef, useState } from "react";
import { THEMES } from "@/lib/theme";
import { ThemePicker } from "./ThemePicker";
import { useTheme } from "./ThemeProvider";
import styles from "./ThemeSwitcher.module.css";

export function ThemeSwitcher() {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
        aria-label={`Color theme: ${active.label}`}
        data-open={open ? "true" : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span
          className={styles.swatch}
          data-theme={active.id}
          aria-hidden="true"
        />
        <span className={styles.triggerLabel}>{active.label}</span>
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
        className={styles.panel}
        data-open={open ? "true" : "false"}
        aria-hidden={!open}
      >
        <div className={styles.panelInner}>
          <p className={styles.panelTitle}>Appearance</p>
          <ThemePicker />
        </div>
      </div>
    </div>
  );
}
