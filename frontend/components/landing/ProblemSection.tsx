"use client";

import styles from "./ProblemSection.module.css";

const SYSTEMS = ["SCADA", "Permit", "Maintenance", "CCTV", "Worker Tracking", "SAP"];

function DisconnectedSystems() {
  return (
    <svg className={styles.diagramSvg} viewBox="0 0 320 260" fill="none"
      aria-label="Disconnected industrial systems">
      {SYSTEMS.map((name, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 30 + col * 160;
        const y = 20 + row * 80;
        return (
          <g key={name}>
            <rect x={x} y={y} width="120" height="44" rx="6"
              fill="var(--surface-card)" stroke="var(--border-default)" strokeWidth="1" />
            <text x={x + 60} y={y + 26} textAnchor="middle"
              className={styles.systemLabel}>{name}</text>
            {/* Broken arrows going outward */}
            {col === 0 && (
              <line x1={x + 120} y1={y + 22} x2={x + 140} y2={y + 22}
                stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 4"
                opacity="0.5" />
            )}
            {col === 1 && (
              <line x1={x} y1={y + 22} x2={x - 20} y2={y + 22}
                stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 4"
                opacity="0.5" />
            )}
            {row < 2 && (
              <line x1={x + 60} y1={y + 44} x2={x + 60} y2={y + 60}
                stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 4"
                opacity="0.5" />
            )}
          </g>
        );
      })}
      {/* Question mark in center */}
      <text x="160" y="245" textAnchor="middle" className={styles.questionMark}>?</text>
    </svg>
  );
}

export function ProblemSection() {
  return (
    <section className={styles.section} id="the-problem">
      <div className={styles.container}>
        <div className={styles.left}>
          <DisconnectedSystems />
        </div>
        <div className={styles.right}>
          <span className={styles.label}>The Problem</span>
          <h2 className={styles.heading}>
            Industrial plants already have the data.<br />
            They just don&apos;t have the complete picture.
          </h2>
          <p className={styles.description}>
            Each system only understands its own part of the plant. Critical
            decisions still rely on manually connecting information spread across
            different systems.
          </p>
          <blockquote className={styles.quote}>
            &ldquo;The problem isn&apos;t missing data. It&apos;s missing synthesis.&rdquo;
          </blockquote>
        </div>
      </div>
    </section>
  );
}
