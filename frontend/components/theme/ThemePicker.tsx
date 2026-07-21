"use client";

import { THEMES } from "@/lib/theme";
import { useTheme } from "./ThemeProvider";
import styles from "./ThemePicker.module.css";

export function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className={styles.grid} role="radiogroup" aria-label="Color theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          className={styles.chip}
          data-active={theme === t.id ? "true" : undefined}
          onClick={() => setTheme(t.id)}
        >
          <span className={styles.swatch} data-theme={t.id} aria-hidden="true" />
          <span className={styles.label}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
