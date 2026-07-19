"use client";

import Link from "next/link";
import styles from "./HeroSection.module.css";

function HeroFloorPlan() {
  return (
    <div className={styles.previewWrap}>
      <div className={styles.previewWindow}>
        <div className={styles.previewTitleBar}>
          <span className={styles.previewDot} data-color="red" />
          <span className={styles.previewDot} data-color="yellow" />
          <span className={styles.previewDot} data-color="green" />
          <span className={styles.previewTitle}>Plant 1 — Coke Oven Complex</span>
        </div>
        <div className={styles.previewBody}>
          <svg
            className={styles.floorSvg}
            viewBox="0 0 420 280"
            fill="none"
            aria-label="Simplified plant floor plan"
          >
            {/* Grid background */}
            <defs>
              <pattern id="hero-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <rect width="20" height="20" fill="var(--surface-canvas)" />
                <circle cx="1" cy="1" r="0.6" fill="var(--border-muted)" />
              </pattern>
            </defs>
            <rect width="420" height="280" fill="url(#hero-grid)" />

            {/* Zone boundaries */}
            <rect x="20" y="20" width="160" height="110" rx="4"
              stroke="var(--border-default)" strokeWidth="1" fill="none"
              strokeDasharray="4 3" />
            <text x="28" y="36" className={styles.svgLabel}>ZONE A — FURNACE</text>

            <rect x="200" y="20" width="200" height="110" rx="4"
              stroke="var(--border-default)" strokeWidth="1" fill="none"
              strokeDasharray="4 3" />
            <text x="208" y="36" className={styles.svgLabel}>ZONE B — STORAGE</text>

            <rect x="20" y="150" width="380" height="110" rx="4"
              stroke="var(--border-default)" strokeWidth="1" fill="none"
              strokeDasharray="4 3" />
            <text x="28" y="166" className={styles.svgLabel}>ZONE C — PROCESSING</text>

            {/* Boiler 1 */}
            <rect x="40" y="55" width="50" height="35" rx="3"
              fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
            <text x="52" y="77" className={styles.svgAsset}>BLR-01</text>

            {/* Boiler 2 — highlighted (risk) */}
            <rect x="110" y="55" width="50" height="35" rx="3"
              fill="var(--status-blocking-muted)" stroke="var(--status-blocking)" strokeWidth="1.5"
              className={styles.riskPulse} />
            <text x="118" y="77" className={styles.svgAssetRisk}>BLR-02</text>

            {/* Storage tanks */}
            <circle cx="240" cy="75" r="20" fill="var(--surface-card)"
              stroke="var(--border-default)" strokeWidth="1" />
            <text x="228" y="79" className={styles.svgAsset}>TK-01</text>

            <circle cx="310" cy="75" r="20" fill="var(--surface-card)"
              stroke="var(--border-default)" strokeWidth="1" />
            <text x="298" y="79" className={styles.svgAsset}>TK-02</text>

            <circle cx="370" cy="75" r="15" fill="var(--surface-card)"
              stroke="var(--border-default)" strokeWidth="1" />
            <text x="360" y="79" className={styles.svgAssetSm}>TK-03</text>

            {/* Pipelines */}
            <line x1="90" y1="72" x2="110" y2="72"
              stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
            <line x1="160" y1="72" x2="220" y2="75"
              stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
            <line x1="260" y1="75" x2="290" y2="75"
              stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
            <line x1="135" y1="90" x2="135" y2="150"
              stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />

            {/* Processing equipment */}
            <rect x="50" y="180" width="70" height="40" rx="3"
              fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
            <text x="58" y="204" className={styles.svgAsset}>COMP-01</text>

            <rect x="170" y="180" width="70" height="40" rx="3"
              fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
            <text x="178" y="204" className={styles.svgAsset}>PUMP-03</text>

            <rect x="290" y="180" width="70" height="40" rx="3"
              fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
            <text x="298" y="204" className={styles.svgAsset}>VALVE-07</text>

            {/* Pipeline in processing */}
            <line x1="120" y1="200" x2="170" y2="200"
              stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />
            <line x1="240" y1="200" x2="290" y2="200"
              stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 2" />

            {/* Gas sensor */}
            <circle cx="145" cy="108" r="5" fill="var(--status-elevated)"
              className={styles.sensorPulse} />
            <text x="154" y="112" className={styles.svgSensor}>GAS</text>

            {/* Permit marker */}
            <rect x="100" y="42" width="8" height="8" rx="1"
              fill="var(--status-elevated)" />
            <text x="112" y="50" className={styles.svgPermit}>HOT WORK</text>

            {/* Workers */}
            <circle cx="125" cy="95" r="3.5" fill="var(--accent-selection)" />
            <circle cx="138" cy="100" r="3.5" fill="var(--accent-selection)" />

            {/* Hazard zone overlay */}
            <rect x="95" y="40" width="80" height="75" rx="4"
              fill="var(--status-blocking)" fillOpacity="0.06"
              stroke="var(--status-blocking)" strokeWidth="1" strokeDasharray="6 3"
              className={styles.hazardZone} />
          </svg>
        </div>
      </div>

      {/* Risk panel */}
      <div className={styles.riskPanel}>
        <div className={styles.riskHeader}>
          <span className={styles.riskDot} />
          Compound Risk Detected
        </div>
        <ul className={styles.riskList}>
          <li className={styles.riskItem}>
            <span className={styles.riskIcon} data-status="elevated">↑</span>
            Gas Increasing
          </li>
          <li className={styles.riskItem}>
            <span className={styles.riskIcon} data-status="elevated">⚠</span>
            Hot Work Permit Active
          </li>
          <li className={styles.riskItem}>
            <span className={styles.riskIcon} data-status="info">●</span>
            2 Workers Nearby
          </li>
        </ul>
        <div className={styles.riskActions}>
          <span className={styles.riskLabel}>Recommendation</span>
          <div className={styles.riskBtnRow}>
            <button className={styles.riskBtnBlock} type="button">Block Operation</button>
            <button className={styles.riskBtnApprove} type="button">Approve With Conditions</button>
          </div>
        </div>
        <div className={styles.riskScore}>
          <span className={styles.riskScoreLabel}>Risk Score</span>
          <span className={styles.riskScoreValue} data-risk="blocking">78</span>
        </div>
      </div>
    </div>
  );
}

export function HeroSection() {
  return (
    <section className={styles.hero} id="hero">
      <div className={styles.container}>
        <div className={styles.left}>
          <h1 className={styles.heading}>
            One Operational View Before Every Critical Decision.
          </h1>
          <p className={styles.description}>
            Industrial plants already have sensors, permits, maintenance systems
            and worker records. SOP Opera brings them together into one
            explainable operational review so supervisors understand compound
            risks before work begins.
          </p>
          <div className={styles.actions}>
            <Link href="/" className="btn btn-primary">
              Launch Demo
            </Link>
            <a href="#digital-twin" className="btn">
              View Architecture
            </a>
          </div>
          <div className={styles.trust}>
            <span className={styles.trustItem}>Built for Industrial Operations</span>
            <span className={styles.trustSep}>·</span>
            <span className={styles.trustItem}>Decision Support</span>
            <span className={styles.trustSep}>·</span>
            <span className={styles.trustItem}>Explainable AI</span>
            <span className={styles.trustSep}>·</span>
            <span className={styles.trustItem}>Digital Twin</span>
          </div>
        </div>
        <div className={styles.right}>
          <HeroFloorPlan />
        </div>
      </div>
    </section>
  );
}
