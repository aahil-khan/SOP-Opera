"use client";

import styles from "./DemoModeBar.module.css";

/**
 * Phase 4: Demo Mode bar is an inert placeholder.
 * Phase 5 wires Start/Reset to POST /demo/scenarios/{name}/start and /demo/reset.
 */
export function DemoModeBar() {
  return (
    <div className={styles.bar} role="region" aria-label="Demo Mode">
      <span className={styles.label}>Demo Mode</span>
      <select className={styles.select} disabled aria-label="Scenario">
        <option>Compound Risk</option>
      </select>
      <button type="button" className="btn btn-primary" disabled>
        Start
      </button>
      <button type="button" className="btn" disabled>
        Reset
      </button>
      <span className={styles.status}>Simulator arrives in Phase 5</span>
    </div>
  );
}
