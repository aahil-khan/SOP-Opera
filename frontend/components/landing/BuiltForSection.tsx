"use client";

import styles from "./BuiltForSection.module.css";

const PERSONAS = [
  {
    title: "Shift Supervisor",
    desc: "Makes go/no-go decisions before high-risk operations begin each shift.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    title: "Safety Officer",
    desc: "Reviews compound risks, ensures compliance, and audits past decisions.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    title: "Plant Operations",
    desc: "Monitors live plant state and coordinates across maintenance, permits and SCADA.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
];

export function BuiltForSection() {
  return (
    <section className={styles.section} id="built-for">
      <div className={styles.container}>
        <span className={styles.label}>Built For</span>
        <h2 className={styles.heading}>
          Designed for the people who make safety decisions
        </h2>
        <div className={styles.cards}>
          {PERSONAS.map((p) => (
            <div className={styles.card} key={p.title}>
              <div className={styles.icon}>{p.icon}</div>
              <h3 className={styles.cardTitle}>{p.title}</h3>
              <p className={styles.cardDesc}>{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
