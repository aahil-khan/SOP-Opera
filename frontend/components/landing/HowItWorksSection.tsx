"use client";

import styles from "./HowItWorksSection.module.css";

const STEPS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 3v18" />
      </svg>
    ),
    label: "Upload Floor Plan",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="8" cy="12" r="2" />
        <path d="M14 10h4M14 14h4" />
      </svg>
    ),
    label: "Generate Digital Twin",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 12h8" />
        <circle cx="5" cy="12" r="3" />
        <circle cx="19" cy="12" r="3" />
      </svg>
    ),
    label: "Connect Existing Systems",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    label: "Build Operational Review",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a7 7 0 017 7c0 3-2 5-3.5 7H8.5C7 14 5 12 5 9a7 7 0 017-7z" />
        <line x1="10" y1="20" x2="14" y2="20" />
        <line x1="10" y1="23" x2="14" y2="23" />
      </svg>
    ),
    label: "AI Assessment",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    label: "Supervisor Decision",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    ),
    label: "Audit Trail",
  },
];

export function HowItWorksSection() {
  return (
    <section className={styles.section} id="how-it-works">
      <div className={styles.container}>
        <span className={styles.label}>How It Works</span>
        <h2 className={styles.heading}>From floor plan to auditable decision</h2>
        <div className={styles.steps}>
          {STEPS.map((step, i) => (
            <div className={styles.stepWrap} key={step.label}>
              <div className={styles.step}>
                <div className={styles.icon}>{step.icon}</div>
                <span className={styles.stepNum}>{String(i + 1).padStart(2, "0")}</span>
                <span className={styles.stepLabel}>{step.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={styles.arrow}>
                  <svg viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M0 6h20M16 1l5 5-5 5" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
