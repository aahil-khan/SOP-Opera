"use client";

import { useState } from "react";
import { useDemoStore } from "@/lib/demoStore";
import {
  SCENARIO_LABELS,
  SCENARIO_NAMES,
  type ScenarioName,
} from "@/lib/mockData";
import styles from "./DemoModeBar.module.css";

export function DemoModeBar() {
  const [scenario, setScenario] = useState<ScenarioName>("compound_risk");
  const startScenario = useDemoStore((s) => s.startScenario);
  const reset = useDemoStore((s) => s.reset);
  const isPlaying = useDemoStore((s) => s.isPlaying);
  const activeScenario = useDemoStore((s) => s.activeScenario);

  return (
    <div className={styles.bar} role="region" aria-label="Demo Mode">
      <span className={styles.label}>Demo Mode</span>
      <select
        className={styles.select}
        value={scenario}
        onChange={(e) => setScenario(e.target.value as ScenarioName)}
        disabled={isPlaying}
        aria-label="Scenario"
      >
        {SCENARIO_NAMES.map((name) => (
          <option key={name} value={name}>
            {SCENARIO_LABELS[name]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-primary"
        disabled={isPlaying}
        onClick={() => startScenario(scenario)}
      >
        Start
      </button>
      <button type="button" className="btn" onClick={() => reset()}>
        Reset
      </button>
      <span className={styles.status}>
        {isPlaying
          ? `Playing ${activeScenario}…`
          : activeScenario
            ? `Last: ${SCENARIO_LABELS[activeScenario]}`
            : "Idle · fixtures seeded"}
      </span>
    </div>
  );
}
