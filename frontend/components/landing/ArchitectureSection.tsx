"use client";

import { m, useReducedMotion } from "framer-motion";
import { SectionShell } from "./SectionShell";
import { EASE_OUT, viewportOnce } from "@/lib/motion";
import styles from "./ArchitectureSection.module.css";

const AGENTS = [
  { id: "scada", label: "SCADA", x: 90, y: 60 },
  { id: "permit", label: "Permit", x: 90, y: 130 },
  { id: "maint", label: "Maintenance", x: 90, y: 200 },
  { id: "workforce", label: "Workforce", x: 90, y: 270 },
];

const ANALYSIS = [
  { id: "spatial", label: "Spatial", x: 300, y: 95 },
  { id: "trend", label: "Predictive trend", x: 300, y: 235 },
];

export function ArchitectureSection() {
  const reduced = useReducedMotion() ?? false;

  const draw = (delay: number) => ({
    initial: { pathLength: 0, opacity: 0 },
    whileInView: { pathLength: 1, opacity: 1 },
    viewport: viewportOnce,
    transition: {
      duration: reduced ? 0 : 0.7,
      ease: EASE_OUT,
      delay: reduced ? 0 : delay,
    },
  });

  return (
    <SectionShell
      id="architecture"
      tone="panel"
      label="Architecture"
      title="Selective fan-out, not a model loop."
      lede="Agents run only where the facts justify them — a nominal review costs one orchestrator pass. Retrieval is driven by the orchestrator, never chosen by the model, so a citation is always available for the record."
    >
      <div className={styles.layout}>
        <div className={styles.diagramWrap}>
          <svg viewBox="0 0 520 340" className={styles.diagram} role="presentation">
            {/* Edges: sources → join */}
            {AGENTS.map((a, i) => (
              <m.path
                key={a.id}
                d={`M ${a.x + 62} ${a.y} C 200 ${a.y}, 200 165, 236 165`}
                className={styles.edge}
                {...draw(0.1 + i * 0.06)}
              />
            ))}
            {/* Join → analysis */}
            {ANALYSIS.map((n, i) => (
              <m.path
                key={n.id}
                d={`M 264 165 C 285 165, 285 ${n.y}, ${n.x - 10} ${n.y}`}
                className={styles.edge}
                {...draw(0.4 + i * 0.06)}
              />
            ))}
            {/* Analysis → verdict */}
            {ANALYSIS.map((n, i) => (
              <m.path
                key={`${n.id}-out`}
                d={`M ${n.x + 78} ${n.y} C 430 ${n.y}, 430 165, 452 165`}
                className={styles.edge}
                {...draw(0.55 + i * 0.06)}
              />
            ))}

            {/* Source agents */}
            {AGENTS.map((a, i) => (
              <m.g
                key={a.id}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={viewportOnce}
                transition={{
                  duration: 0.35,
                  ease: EASE_OUT,
                  delay: reduced ? 0 : i * 0.06,
                }}
              >
                <rect
                  x={a.x - 62}
                  y={a.y - 16}
                  width="124"
                  height="32"
                  rx="16"
                  className={styles.node}
                />
                <text x={a.x} y={a.y + 4} className={styles.nodeLabel}>
                  {a.label}
                </text>
              </m.g>
            ))}

            {/* Orchestrator join */}
            <m.g
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={viewportOnce}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.3 }}
              style={{ transformOrigin: "250px 165px" }}
            >
              <circle cx="250" cy="165" r="14" className={styles.join} />
            </m.g>

            {/* Analysis agents */}
            {ANALYSIS.map((n, i) => (
              <m.g
                key={n.id}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={viewportOnce}
                transition={{
                  duration: 0.35,
                  ease: EASE_OUT,
                  delay: reduced ? 0 : 0.5 + i * 0.06,
                }}
              >
                <rect
                  x={n.x - 10}
                  y={n.y - 16}
                  width="88"
                  height="32"
                  rx="16"
                  className={styles.node}
                  data-kind="analysis"
                />
                <text x={n.x + 34} y={n.y + 4} className={styles.nodeLabel}>
                  {n.label}
                </text>
              </m.g>
            ))}

            {/* Verdict */}
            <m.g
              initial={{ opacity: 0, scale: 0.92 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={viewportOnce}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.75 }}
              style={{ transformOrigin: "486px 165px" }}
            >
              <rect
                x="452"
                y="145"
                width="56"
                height="40"
                rx="8"
                className={styles.verdict}
              />
              <text x="480" y="169" className={styles.verdictLabel}>
                Risk
              </text>
            </m.g>
          </svg>
          <p className={styles.diagramNote}>
            Gated fan-out — agents without matching facts never run.
          </p>
        </div>

        <div className={styles.notes}>
          {[
            {
              t: "Durable job queue",
              b: "Assessments are claimed with FOR UPDATE SKIP LOCKED, so jobs survive restarts and parallel workers never double-run the same review.",
            },
            {
              t: "Hybrid retrieval",
              b: "Vector search over a seeded corpus of regulations, prior incidents and SOPs, with a quality gate and a deterministic SQL fallback beneath it.",
            },
            {
              t: "Knowledge graph",
              b: "Equipment, zones, permits and people are related spatially, so proximity risk is computed rather than guessed.",
            },
            {
              t: "Structured output",
              b: "Every model response is schema-validated with a retry; a failure surfaces to the supervisor instead of degrading quietly into prose.",
            },
          ].map((n, i) => (
            <m.div
              key={n.t}
              className={styles.note}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={viewportOnce}
              transition={{
                duration: 0.4,
                ease: EASE_OUT,
                delay: reduced ? 0 : i * 0.07,
              }}
            >
              <h3 className={styles.noteTitle}>{n.t}</h3>
              <p className={styles.noteBody}>{n.b}</p>
            </m.div>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}
