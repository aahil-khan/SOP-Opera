"use client";

import { m, useReducedMotion } from "framer-motion";
import { SectionShell } from "./SectionShell";
import { RevealItem } from "./Reveal";
import { stagger, viewportOnce, EASE_OUT } from "@/lib/motion";
import styles from "./DashboardSection.module.css";

const SURFACES = [
  {
    title: "Operator dashboard",
    body: "A live floor map across three levels. Assets carry their current risk, telemetry drifts in real time, and anything that turns blocking announces itself.",
  },
  {
    title: "Reasoning trace",
    body: "Click an asset and read the chain backwards: which context arrived, which rules fired, which agents ran, which regulations were retrieved.",
  },
  {
    title: "Supervisor queue",
    body: "Area supervisors see only their zones — the tasks a decision generated, waiting to be acknowledged and cleared before work resumes.",
  },
  {
    title: "Audit record",
    body: "Every transition is appended, every decision freezes its evidence, and closure generates a report an investigator can actually follow.",
  },
];

export function DashboardSection() {
  const reduced = useReducedMotion() ?? false;

  return (
    <SectionShell
      id="dashboard"
      label="The product"
      title="Two roles, two surfaces, one thread between them."
      lede="The control room runs the assessment and owns the decision. The area supervisor receives what that decision requires and closes it out. Nothing crosses roles that shouldn't."
    >
      <div className={styles.layout}>
        <m.div
          className={styles.cards}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          variants={stagger(0.08)}
        >
          {SURFACES.map((s) => (
            <RevealItem key={s.title} className={styles.card} as="article">
              <h3 className={styles.cardTitle}>{s.title}</h3>
              <p className={styles.cardBody}>{s.body}</p>
            </RevealItem>
          ))}
        </m.div>

        <m.div
          className={styles.frame}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        >
          <div className={styles.frameBar}>
            <span className={styles.frameDot} />
            <span className={styles.frameDot} />
            <span className={styles.frameDot} />
            <span className={styles.frameTitle}>
              Operator dashboard — Plant 1
            </span>
          </div>
          <div className={styles.frameBody}>
            <div className={styles.mockNav}>
              <span data-active="true">Operator Dashboard</span>
              <span>Reports</span>
              <span>Eval</span>
              <span>AI Ops</span>
              <span>Shift Handover</span>
            </div>
            <div className={styles.mockMain}>
              <div className={styles.mockList}>
                <span className="section-label">Open work</span>
                {[
                  { name: "Vessel A", risk: "blocking" },
                  { name: "Compressor B", risk: "elevated" },
                  { name: "Tank Farm C", risk: "nominal" },
                ].map((r) => (
                  <div key={r.name} className={styles.mockRow}>
                    <span className={styles.mockDot} data-risk={r.risk} />
                    <span className={styles.mockName}>{r.name}</span>
                    <span className="badge" data-risk={r.risk}>
                      {r.risk}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.mockMap}>
                <div className={styles.mockMapGrid} />
                <m.span
                  className={styles.mockPin}
                  data-risk="blocking"
                  animate={
                    reduced ? {} : { scale: [1, 1.18, 1], opacity: [1, 0.7, 1] }
                  }
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
                <span className={styles.mockPin} data-risk="elevated" />
                <span className={styles.mockPin} data-risk="nominal" />
              </div>
            </div>
          </div>
        </m.div>
      </div>
    </SectionShell>
  );
}
