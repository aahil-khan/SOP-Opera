"use client";

import styles from "./WhyAISection.module.css";

const COLUMNS = [
  {
    title: "Rules",
    accent: false,
    items: ["Gas above threshold", "Permit conflict", "Zone occupied"],
  },
  {
    title: "Retrieval",
    accent: false,
    items: ["Relevant SOP", "Regulations", "Past Incidents"],
  },
  {
    title: "Assessment",
    accent: true,
    items: [
      "Natural language explanation",
      "Recommended actions",
      "Evidence & traceability",
    ],
  },
];

export function WhyAISection() {
  return (
    <section className={styles.section} id="why-ai">
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.sectionLabel}>Why AI</span>
          <h2 className={styles.heading}>
            Rules detect facts. AI explains them.
          </h2>
          <p className={styles.subtext}>
            AI does not replace rule-based safety systems. It augments them by
            synthesizing context, retrieving relevant knowledge, and producing
            explainable assessments.
          </p>
        </div>
        <div className={styles.columns}>
          {COLUMNS.map((col, i) => (
            <div className={styles.colWrap} key={col.title}>
              <div
                className={styles.card}
                data-accent={col.accent ? "true" : undefined}
              >
                <span className={styles.cardTitle}>{col.title}</span>
                <ul className={styles.list}>
                  {col.items.map((item) => (
                    <li className={styles.listItem} key={item}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              {i < COLUMNS.length - 1 && (
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
