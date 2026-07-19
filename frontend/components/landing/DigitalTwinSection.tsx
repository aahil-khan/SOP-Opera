"use client";

import styles from "./DigitalTwinSection.module.css";

const CHAIN_STEPS = [
  { label: "Asset", desc: "Boiler BLR-02" },
  { label: "Context", desc: "Gas level 42 ppm, rising" },
  { label: "Derived Facts", desc: "Near hot work permit, 2 workers in zone" },
  { label: "Regulations", desc: "IS 6923:2018 §4.3, Plant SOP-12" },
  { label: "Assessment", desc: "Compound risk: gas + ignition source + personnel" },
  { label: "Recommendation", desc: "Block operation until gas < 20 ppm" },
  { label: "Supervisor Decision", desc: "Approve / Block / Conditional" },
];

function FactoryLayout() {
  return (
    <svg className={styles.factorySvg} viewBox="0 0 400 320" fill="none"
      aria-label="Digital twin factory layout">
      <defs>
        <pattern id="twin-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill="var(--surface-canvas)" />
          <circle cx="1" cy="1" r="0.6" fill="var(--border-muted)" />
        </pattern>
      </defs>
      <rect width="400" height="320" fill="url(#twin-grid)" rx="8" />

      {/* Zone A */}
      <rect x="15" y="15" width="175" height="140" rx="4"
        stroke="var(--border-default)" strokeWidth="1" fill="none" strokeDasharray="4 3" />
      <text x="22" y="30" className={styles.zoneLabel}>ZONE A — FURNACE</text>

      {/* Zone B */}
      <rect x="210" y="15" width="175" height="140" rx="4"
        stroke="var(--border-default)" strokeWidth="1" fill="none" strokeDasharray="4 3" />
      <text x="218" y="30" className={styles.zoneLabel}>ZONE B — STORAGE</text>

      {/* Zone C */}
      <rect x="15" y="175" width="370" height="130" rx="4"
        stroke="var(--border-default)" strokeWidth="1" fill="none" strokeDasharray="4 3" />
      <text x="22" y="190" className={styles.zoneLabel}>ZONE C — PROCESSING</text>

      {/* Machines Zone A */}
      <rect x="30" y="50" width="60" height="40" rx="3"
        fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
      <text x="42" y="74" className={styles.assetLabel}>BLR-01</text>

      <rect x="110" y="50" width="60" height="40" rx="3"
        fill="var(--status-blocking-muted)" stroke="var(--status-blocking)" strokeWidth="1.5"
        className={styles.riskPulse} />
      <text x="120" y="74" className={styles.assetRisk}>BLR-02</text>

      {/* Permit overlay */}
      <rect x="100" y="38" width="80" height="65" rx="4"
        fill="var(--status-elevated)" fillOpacity="0.07"
        stroke="var(--status-elevated)" strokeWidth="1" strokeDasharray="5 3" />
      <text x="105" y="48" className={styles.permitLabel}>PERMIT</text>

      {/* Storage tanks */}
      <circle cx="250" cy="85" r="22" fill="var(--surface-card)"
        stroke="var(--border-default)" strokeWidth="1" />
      <text x="238" y="89" className={styles.assetLabel}>TK-01</text>

      <circle cx="330" cy="85" r="22" fill="var(--surface-card)"
        stroke="var(--border-default)" strokeWidth="1" />
      <text x="318" y="89" className={styles.assetLabel}>TK-02</text>

      {/* Pipelines */}
      <line x1="90" y1="70" x2="110" y2="70" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="170" y1="70" x2="228" y2="85" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="272" y1="85" x2="308" y2="85" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="140" y1="103" x2="140" y2="175" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />

      {/* Processing */}
      <rect x="40" y="210" width="80" height="45" rx="3"
        fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
      <text x="52" y="237" className={styles.assetLabel}>COMP-01</text>

      <rect x="160" y="210" width="80" height="45" rx="3"
        fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
      <text x="172" y="237" className={styles.assetLabel}>PUMP-03</text>

      <rect x="280" y="210" width="80" height="45" rx="3"
        fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
      <text x="290" y="237" className={styles.assetLabel}>VALVE-07</text>

      <line x1="120" y1="232" x2="160" y2="232" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="240" y1="232" x2="280" y2="232" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />

      {/* Workers */}
      <circle cx="130" cy="95" r="4" fill="var(--accent-selection)" />
      <circle cx="148" cy="100" r="4" fill="var(--accent-selection)" />

      {/* Gas sensor */}
      <circle cx="150" cy="120" r="5" fill="var(--status-elevated)"
        className={styles.sensorPulse} />
      <text x="158" y="124" className={styles.sensorLabel}>GAS</text>

      {/* Risk indicators */}
      <circle cx="140" cy="70" r="8" fill="none"
        stroke="var(--status-blocking)" strokeWidth="1" strokeDasharray="3 2"
        className={styles.riskIndicator} />
    </svg>
  );
}

function ReasoningChain() {
  return (
    <div className={styles.chain}>
      {CHAIN_STEPS.map((step, i) => (
        <div className={styles.chainStep} key={step.label}>
          <div className={styles.chainDot}>
            <span className={styles.dot} />
            {i < CHAIN_STEPS.length - 1 && <span className={styles.chainLine} />}
          </div>
          <div className={styles.chainContent}>
            <span className={styles.chainLabel}>{step.label}</span>
            <span className={styles.chainDesc}>{step.desc}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DigitalTwinSection() {
  return (
    <section className={styles.section} id="digital-twin">
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.sectionLabel}>Digital Twin</span>
          <h2 className={styles.heading}>
            From physical plant to operational intelligence
          </h2>
        </div>
        <div className={styles.columns}>
          <div className={styles.left}>
            <FactoryLayout />
          </div>
          <div className={styles.right}>
            <span className={styles.chainTitle}>Reasoning Chain</span>
            <ReasoningChain />
          </div>
        </div>
      </div>
    </section>
  );
}
