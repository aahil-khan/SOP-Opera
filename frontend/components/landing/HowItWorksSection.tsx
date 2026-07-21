"use client";

import { m, useReducedMotion } from "framer-motion";
import { SectionShell } from "./SectionShell";
import { EASE_OUT, viewportOnce } from "@/lib/motion";
import styles from "./HowItWorksSection.module.css";

const STEPS = [
  {
    n: "01",
    title: "Context arrives",
    body: "Sensor readings, permits, isolation state, worker location and shift logs land through one provider interface — the same seam a live SCADA or permit system plugs into.",
    tag: "POST /context",
  },
  {
    n: "02",
    title: "Rules derive facts",
    body: "Deterministic Python turns raw context into named facts — elevated gas, permit conflict, incomplete isolation, zone occupied. No model decides what is true.",
    tag: "derived_facts.py",
  },
  {
    n: "03",
    title: "Agents correlate",
    body: "A multi-agent graph fans out only where the facts warrant: source agents per domain, then spatial, predictive-trend, and shift-handover carry-forward, then incident-pattern on elevated verdicts.",
    tag: "LangGraph",
  },
  {
    n: "04",
    title: "Retrieval grounds it",
    body: "Hybrid retrieval pulls regulations, prior incidents and SOPs — vector search first, deterministic SQL as a guaranteed fallback so citations are never empty.",
    tag: "pgvector + SQL",
  },
  {
    n: "05",
    title: "A human decides",
    body: "The assessment explains what the combination means and recommends. The supervisor approves, conditions or blocks — and that call is the binding act.",
    tag: "POST /decisions",
  },
  {
    n: "06",
    title: "Evidence freezes",
    body: "The context and assessment cited at decision time are snapshotted, follow-up tasks are dispatched to the area supervisor, and a report closes the loop.",
    tag: "Audit trail",
  },
];

export function HowItWorksSection() {
  const reduced = useReducedMotion() ?? false;

  return (
    <SectionShell
      id="how"
      label="How it works"
      title="Deterministic where it must be. Generative only where it helps."
      lede="Rules detect. Agents correlate. Retrieval grounds. A human decides. Each stage is separately inspectable, which is what makes the output defensible after an incident."
    >
      <ol className={styles.steps}>
        {STEPS.map((s, i) => (
          <m.li
            key={s.n}
            className={styles.step}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={viewportOnce}
            transition={{
              duration: 0.4,
              ease: EASE_OUT,
              delay: reduced ? 0 : i * 0.07,
            }}
          >
            <div className={styles.marker}>
              <span className={styles.markerNum}>{s.n}</span>
              {i < STEPS.length - 1 ? (
                <m.span
                  className={styles.markerLine}
                  initial={{ scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={viewportOnce}
                  transition={{
                    duration: reduced ? 0 : 0.5,
                    ease: EASE_OUT,
                    delay: reduced ? 0 : 0.15 + i * 0.07,
                  }}
                />
              ) : null}
            </div>
            <div className={styles.body}>
              <div className={styles.stepHead}>
                <h3 className={styles.stepTitle}>{s.title}</h3>
                <code className={styles.tag}>{s.tag}</code>
              </div>
              <p className={styles.stepText}>{s.body}</p>
            </div>
          </m.li>
        ))}
      </ol>
    </SectionShell>
  );
}
