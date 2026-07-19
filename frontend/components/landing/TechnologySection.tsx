"use client";

import styles from "./TechnologySection.module.css";

const TECH = [
  "React",
  "FastAPI",
  "PostgreSQL",
  "WebSockets",
  "SVG",
  "RAG",
  "OpenAI Compatible",
  "Simulator",
];

export function TechnologySection() {
  return (
    <section className={styles.section} id="technology">
      <div className={styles.container}>
        <span className={styles.label}>Technology</span>
        <div className={styles.chips}>
          {TECH.map((t) => (
            <span className={styles.chip} key={t}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
