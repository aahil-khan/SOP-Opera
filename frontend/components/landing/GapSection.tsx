"use client";

import { m, useReducedMotion } from "framer-motion";
import { SectionShell } from "./SectionShell";
import { RevealItem } from "./Reveal";
import { CountUp } from "./CountUp";
import { rise, respectMotion, stagger, viewportOnce } from "@/lib/motion";
import styles from "./GapSection.module.css";

const STATS = [
  {
    value: 6500,
    suffix: "+",
    label: "Fatal workplace accidents recorded in FY2023",
    note: "DGFASLI — and that figure excludes most mining and construction.",
  },
  {
    value: 60,
    suffix: "%",
    label: "Of large facilities coordinate safety tooling by hand",
    note: "FICCI 2024 — manual handoffs between systems that already hold the data.",
  },
];

const SILOS = [
  { name: "Gas detection", reads: "This sensor is within limits." },
  { name: "Permit to work", reads: "This permit is valid." },
  { name: "Maintenance", reads: "This isolation is logged." },
  { name: "Workforce", reads: "This worker is certified." },
];

export function GapSection() {
  const reduced = useReducedMotion() ?? false;

  return (
    <SectionShell
      id="gap"
      label="The gap"
      title="Every system says everything is fine. Together they are not."
      lede="Industrial plants are already instrumented. The failure is not missing data — it is that each system judges its own slice in isolation, so a combination that is obviously dangerous to a human never registers anywhere as an alarm."
    >
      <m.div
        className={styles.silos}
        initial="hidden"
        whileInView="visible"
        viewport={viewportOnce}
        variants={stagger(0.08)}
      >
        {SILOS.map((s) => (
          <RevealItem key={s.name} className={styles.silo} as="article">
            <span className={styles.siloName}>{s.name}</span>
            <span className={styles.siloReads}>{s.reads}</span>
            <span className={styles.siloVerdict}>No alarm</span>
          </RevealItem>
        ))}
      </m.div>

      <m.div
        className={styles.join}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
      >
        <span className={styles.joinRule} aria-hidden="true" />
        <p className={styles.joinText}>
          Read together, the same four readings describe hot work authorised
          beside rising gas with people in the blast path.
        </p>
        <span className={styles.joinRule} aria-hidden="true" />
      </m.div>

      <m.div
        className={styles.stats}
        initial="hidden"
        whileInView="visible"
        viewport={viewportOnce}
        variants={stagger(0.1)}
      >
        {STATS.map((s) => (
          <m.div
            key={s.label}
            className={styles.stat}
            variants={respectMotion(rise, reduced)}
          >
            <span className={styles.statValue}>
              <CountUp to={s.value} />
              {s.suffix}
            </span>
            <span className={styles.statLabel}>{s.label}</span>
            <span className={styles.statNote}>{s.note}</span>
          </m.div>
        ))}
      </m.div>
    </SectionShell>
  );
}
