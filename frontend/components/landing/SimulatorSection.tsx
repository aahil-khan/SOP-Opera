"use client";

import styles from "./SimulatorSection.module.css";

const TIMELINE = [
  { time: "00:00", event: "Leak Detected", status: "info" },
  { time: "00:20", event: "Gas Rising", status: "elevated" },
  { time: "00:35", event: "Maintenance Active", status: "elevated" },
  { time: "00:45", event: "Worker Enters Zone", status: "elevated" },
  { time: "00:50", event: "Compound Risk", status: "blocking" },
  { time: "00:52", event: "Recommendation Generated", status: "blocking" },
];

function SimFloorPlan() {
  return (
    <svg className={styles.simSvg} viewBox="0 0 280 200" fill="none"
      aria-label="Animated risk propagation">
      <defs>
        <pattern id="sim-grid" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill="var(--surface-canvas)" />
          <circle cx="1" cy="1" r="0.5" fill="var(--border-muted)" />
        </pattern>
      </defs>
      <rect width="280" height="200" fill="url(#sim-grid)" rx="6" />

      {/* Zone outline */}
      <rect x="20" y="20" width="240" height="160" rx="4"
        stroke="var(--border-default)" strokeWidth="1" fill="none" strokeDasharray="4 3" />
      <text x="28" y="35" className={styles.simLabel}>ZONE A</text>

      {/* Equipment */}
      <rect x="40" y="60" width="50" height="35" rx="3"
        fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
      <text x="48" y="82" className={styles.simAsset}>BLR-02</text>

      <rect x="140" y="80" width="50" height="35" rx="3"
        fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
      <text x="148" y="102" className={styles.simAsset}>VALVE</text>

      <rect x="200" y="120" width="40" height="30" rx="3"
        fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
      <text x="205" y="140" className={styles.simAsset}>PUMP</text>

      {/* Pipeline */}
      <line x1="90" y1="77" x2="140" y2="97"
        stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="190" y1="97" x2="200" y2="135"
        stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />

      {/* Leak origin */}
      <circle cx="65" cy="77" r="6" fill="var(--status-blocking)" fillOpacity="0.3"
        className={styles.leakOrigin} />
      <circle cx="65" cy="77" r="3" fill="var(--status-blocking)" />

      {/* Risk propagation rings */}
      <circle cx="65" cy="77" r="20" fill="none"
        stroke="var(--status-blocking)" strokeWidth="1" strokeOpacity="0.5"
        className={styles.propagateRing1} />
      <circle cx="65" cy="77" r="45" fill="none"
        stroke="var(--status-elevated)" strokeWidth="1" strokeOpacity="0.3"
        className={styles.propagateRing2} />
      <circle cx="65" cy="77" r="75" fill="none"
        stroke="var(--status-elevated)" strokeWidth="0.5" strokeOpacity="0.2"
        className={styles.propagateRing3} />

      {/* Worker */}
      <circle cx="100" cy="110" r="4" fill="var(--accent-selection)" />
      <text x="108" y="114" className={styles.simWorker}>W1</text>
    </svg>
  );
}

export function SimulatorSection() {
  return (
    <section className={styles.section} id="simulator">
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.sectionLabel}>Simulator</span>
          <h2 className={styles.heading}>Test scenarios before they happen</h2>
        </div>
        <div className={styles.terminal}>
          <div className={styles.terminalLeft}>
            <div className={styles.scenarioHeader}>
              <span className={styles.scenarioTag}>SCENARIO</span>
              <span className={styles.scenarioName}>Gas Leak — Coke Oven Battery</span>
            </div>
            <div className={styles.timeline}>
              {TIMELINE.map((entry) => (
                <div className={styles.timelineEntry} key={entry.time}>
                  <span className={styles.timeCode}>{entry.time}</span>
                  <span className={styles.timeDot} data-status={entry.status} />
                  <span className={styles.timeEvent}>{entry.event}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.terminalRight}>
            <SimFloorPlan />
          </div>
        </div>
      </div>
    </section>
  );
}
