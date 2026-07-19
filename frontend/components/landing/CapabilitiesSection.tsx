"use client";

import styles from "./CapabilitiesSection.module.css";

const CAPABILITIES = [
  {
    title: "Digital Twin",
    desc: "Interactive SVG floor plan with zones, machines, workers and real-time overlays.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 3v18" />
      </svg>
    ),
  },
  {
    title: "Operational Reviews",
    desc: "Structured per-shift reviews combining permits, maintenance, sensors and staffing.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    title: "Compound Risk Detection",
    desc: "Identifies when individually safe conditions combine to create dangerous scenarios.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    title: "Explainable AI Assessment",
    desc: "Every recommendation includes reasoning, evidence and traceability back to source.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a7 7 0 017 7c0 3-2 5-3.5 7H8.5C7 14 5 12 5 9a7 7 0 017-7z" />
        <line x1="10" y1="20" x2="14" y2="20" />
        <line x1="10" y1="23" x2="14" y2="23" />
      </svg>
    ),
  },
  {
    title: "Permit Intelligence",
    desc: "Tracks active permits against live plant state to detect conflicts and overlaps.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M9 16l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Simulation Mode",
    desc: "Run what-if scenarios to test plant response to gas leaks, equipment failures and evacuations.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
  },
  {
    title: "Knowledge Base",
    desc: "SOPs, regulations and past incidents indexed for retrieval-augmented assessments.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        <line x1="9" y1="7" x2="16" y2="7" />
        <line x1="9" y1="11" x2="14" y2="11" />
      </svg>
    ),
  },
  {
    title: "Realtime Context",
    desc: "WebSocket-driven updates from sensors, SCADA feeds and worker tracking systems.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

export function CapabilitiesSection() {
  return (
    <section className={styles.section} id="capabilities">
      <div className={styles.container}>
        <span className={styles.label}>Key Capabilities</span>
        <h2 className={styles.heading}>Everything supervisors need in one place</h2>
        <div className={styles.grid}>
          {CAPABILITIES.map((cap) => (
            <div className={styles.card} key={cap.title}>
              <div className={styles.icon}>{cap.icon}</div>
              <h3 className={styles.cardTitle}>{cap.title}</h3>
              <p className={styles.cardDesc}>{cap.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
