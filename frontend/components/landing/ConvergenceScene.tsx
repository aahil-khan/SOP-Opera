"use client";

import { useEffect, useState } from "react";
import { m, useReducedMotion } from "framer-motion";
import styles from "./ConvergenceScene.module.css";

/**
 * Hero centerpiece: three independent signals converging into one blocking
 * verdict — the product's whole thesis in one loop.
 *
 * Layout rules that keep this from drifting: every label is text-anchor
 * middle at its shape's centre, and nothing animates via SVG `scale` +
 * transformOrigin (unreliable across browsers). Motion is opacity, attribute
 * animation, and CSS keyframes with `transform-box: fill-box`.
 */

/** 0 idle · 1 gas · 2 permit · 3 people · 4 ignite · 5 verdict */
type Beat = 0 | 1 | 2 | 3 | 4 | 5;

const BEAT_MS: Record<Beat, number> = {
  0: 1100,
  1: 1200,
  2: 1200,
  3: 1200,
  4: 1000,
  5: 3000,
};

const VB = { w: 1120, h: 420 };
const CENTER = { x: 560, y: 210 };

const SOURCES = [
  {
    beat: 1 as Beat,
    y: 74,
    tone: "elevated",
    system: "SCADA · Gas detection",
    reading: "27.4 ppm",
    verdict: "Below its own alarm line",
  },
  {
    beat: 2 as Beat,
    y: 210,
    tone: "elevated",
    system: "Permit to work",
    reading: "PTW-4471 · Hot work",
    verdict: "Valid, correctly issued",
  },
  {
    beat: 3 as Beat,
    y: 346,
    tone: "info",
    system: "Workforce tracking",
    reading: "2 workers · Zone A",
    verdict: "Both certified, in date",
  },
];

const CARD = { w: 300, x: 40, h: 92 };

export function ConvergenceScene() {
  const reduced = useReducedMotion() ?? false;
  const [beat, setBeat] = useState<Beat>(reduced ? 5 : 0);

  useEffect(() => {
    if (reduced) {
      setBeat(5);
      return;
    }
    const id = window.setTimeout(
      () => setBeat((b) => ((b + 1) % 6) as Beat),
      BEAT_MS[beat],
    );
    return () => window.clearTimeout(id);
  }, [beat, reduced]);

  const ignited = beat >= 4;
  const verdictOn = beat >= 5;

  return (
    <div className={styles.scene} data-ignited={ignited}>
      <div className={styles.frame}>
        <div className={styles.bar}>
          <span className={styles.barDot} data-live={!reduced} />
          <span className={styles.barTitle}>Compound risk engine</span>
          <span className={styles.barMeta}>
            Plant 1 · Zone coke-oven-battery
          </span>
          <span className={styles.barState} data-ignited={ignited}>
            {ignited ? "Blocking" : beat >= 1 ? "Correlating" : "Nominal"}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${VB.w} ${VB.h}`}
          className={styles.svg}
          role="img"
          aria-label="Three plant signals converging into one blocking verdict"
        >
          <defs>
            <filter id="cv-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="10" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="cv-beam-elevated" x1="0" x2="1">
              <stop offset="0%" stopColor="var(--status-elevated)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--status-elevated)" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="cv-beam-info" x1="0" x2="1">
              <stop offset="0%" stopColor="var(--accent-selection)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--accent-selection)" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="cv-beam-out" x1="0" x2="1">
              <stop offset="0%" stopColor="var(--status-blocking)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--status-blocking)" stopOpacity="1" />
            </linearGradient>
          </defs>

          {/* ── Beams: source → centre ── */}
          {SOURCES.map((s) => {
            const on = beat >= s.beat;
            const x0 = CARD.x + CARD.w;
            const d = `M ${x0} ${s.y} C ${x0 + 110} ${s.y}, ${CENTER.x - 190} ${CENTER.y}, ${CENTER.x - 92} ${CENTER.y}`;
            return (
              <g key={`beam-${s.beat}`}>
                <path d={d} className={styles.beamTrack} />
                <path
                  d={d}
                  className={styles.beamLive}
                  data-on={on}
                  stroke={`url(#cv-beam-${s.tone})`}
                />
              </g>
            );
          })}

          {/* ── Beam: centre → verdict ── */}
          <path
            d={`M ${CENTER.x + 92} ${CENTER.y} H 828`}
            className={styles.beamTrack}
          />
          <path
            d={`M ${CENTER.x + 92} ${CENTER.y} H 828`}
            className={styles.beamLive}
            data-on={ignited}
            stroke="url(#cv-beam-out)"
          />

          {/* ── Source cards ── */}
          {SOURCES.map((s) => {
            const on = beat >= s.beat;
            const cx = CARD.x + CARD.w / 2;
            return (
              <g key={s.system} className={styles.source} data-on={on}>
                <rect
                  x={CARD.x}
                  y={s.y - CARD.h / 2}
                  width={CARD.w}
                  height={CARD.h}
                  rx="12"
                  className={styles.sourceBox}
                  data-tone={s.tone}
                  data-on={on}
                />
                <text
                  x={cx}
                  y={s.y - 22}
                  className={styles.sourceSystem}
                  textAnchor="middle"
                >
                  {s.system.toUpperCase()}
                </text>
                <text
                  x={cx}
                  y={s.y + 6}
                  className={styles.sourceReading}
                  data-tone={s.tone}
                  data-on={on}
                  textAnchor="middle"
                >
                  {s.reading}
                </text>
                <text
                  x={cx}
                  y={s.y + 30}
                  className={styles.sourceVerdict}
                  textAnchor="middle"
                >
                  {s.verdict}
                </text>
              </g>
            );
          })}

          {/* ── Centre node ── */}
          <g className={styles.core} data-ignited={ignited}>
            {ignited && !reduced && (
              <>
                <circle
                  cx={CENTER.x}
                  cy={CENTER.y}
                  r="74"
                  className={styles.ring}
                  style={{ animationDelay: "0s" }}
                />
                <circle
                  cx={CENTER.x}
                  cy={CENTER.y}
                  r="74"
                  className={styles.ring}
                  style={{ animationDelay: "0.9s" }}
                />
              </>
            )}
            <circle
              cx={CENTER.x}
              cy={CENTER.y}
              r="74"
              className={styles.coreHalo}
              data-ignited={ignited}
              filter="url(#cv-glow)"
            />
            <circle
              cx={CENTER.x}
              cy={CENTER.y}
              r="66"
              className={styles.coreBody}
              data-ignited={ignited}
            />
            <text
              x={CENTER.x}
              y={CENTER.y - 12}
              className={styles.coreLabel}
              textAnchor="middle"
            >
              VESSEL A
            </text>
            <text
              x={CENTER.x}
              y={CENTER.y + 14}
              className={styles.coreValue}
              data-ignited={ignited}
              textAnchor="middle"
            >
              {ignited ? "BLOCKING" : `${Math.min(beat, 3)}/3`}
            </text>
            <text
              x={CENTER.x}
              y={CENTER.y + 36}
              className={styles.coreSub}
              textAnchor="middle"
            >
              {ignited ? "compound" : "signals"}
            </text>
          </g>

          {/* ── Verdict card ── */}
          <g className={styles.result} data-on={verdictOn}>
            <rect
              x="828"
              y="140"
              width="252"
              height="140"
              rx="14"
              className={styles.resultBox}
            />
            <text x="954" y="176" className={styles.resultKicker} textAnchor="middle">
              ASSESSMENT
            </text>
            <text x="954" y="212" className={styles.resultTitle} textAnchor="middle">
              Do not proceed
            </text>
            <text x="954" y="240" className={styles.resultBody} textAnchor="middle">
              Hot work beside rising gas
            </text>
            <text x="954" y="260" className={styles.resultBody} textAnchor="middle">
              with two people in the zone
            </text>
          </g>
        </svg>

        <div className={styles.foot}>
          {SOURCES.map((s) => (
            <span
              key={s.system}
              className={styles.footStep}
              data-on={beat >= s.beat}
            />
          ))}
          <span className={styles.footLabel}>
            {ignited
              ? "No single sensor crossed its own threshold."
              : "Correlating live plant signals…"}
          </span>
        </div>
      </div>

      {/* Ambient glow that intensifies on ignition */}
      <m.div
        className={styles.bloom}
        aria-hidden="true"
        animate={{ opacity: ignited ? 1 : 0.35 }}
        transition={{ duration: 0.6 }}
      />
    </div>
  );
}
