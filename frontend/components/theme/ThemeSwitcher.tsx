"use client";

import { THEMES } from "@/lib/theme";
import { useTheme } from "./ThemeProvider";
import styles from "./ThemeSwitcher.module.css";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <label className={styles.wrap}>
      <span className={styles.label}>Theme</span>
      <select
        className={styles.select}
        value={theme}
        onChange={(e) => setTheme(e.target.value as typeof theme)}
        aria-label="Color theme"
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
