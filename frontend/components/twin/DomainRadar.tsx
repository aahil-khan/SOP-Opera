"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveAssetView } from "@/lib/liveStore";
import { useLiveStore } from "@/lib/liveStore";
import {
  DOMAINS,
  DOMAIN_META,
  computeAllDomainScores,
  type DomainId,
  type DomainScore,
} from "@/lib/domains";
import { DomainDetailFlyout } from "./DomainDetailFlyout";
import styles from "./DomainRadar.module.css";

const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2 + 4;
const MAX_R = 108;
/** Floor so every axis always reads as a real point, even at score 0. */
const MIN_R = 22;
/** Hit targets extend slightly past the rim. */
const HIT_R = MAX_R + 10;
/** Labels sit just outside the midpoints of the outer edges. */
const LABEL_OUTSET = 14;

const N = DOMAINS.length;
/** Rotate so a flat side faces each domain (labels on sides, corners between). */
const CORNER_OFFSET = 360 / N / 2;

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

/** Angle of the flat side midpoint for domain i (0 = top flat). */
function edgeMidAngle(i: number): number {
  return (360 / N) * i;
}

/** Angle of corner i (between sides i-1 and i). */
function cornerAngle(i: number): number {
  return edgeMidAngle(i) - CORNER_OFFSET;
}

function radiusForScore(score: number, empty: boolean): number {
  if (empty) return MIN_R * 0.55;
  return MIN_R + (score / 100) * (MAX_R - MIN_R);
}

const EMPTY_COLOR = "var(--text-muted)";

function domainPaint(domain: DomainId, empty: boolean): string {
  return empty ? EMPTY_COLOR : `var(${DOMAIN_META[domain].colorVar})`;
}

/** Triangle covering the face between two adjacent corners. */
function facePoints(i: number, r: number): string {
  const a = polar(cornerAngle(i), r);
  const b = polar(cornerAngle(i + 1), r);
  return `${CX},${CY} ${a.x},${a.y} ${b.x},${b.y}`;
}

/** Geometric midpoint of the outer edge for domain i. */
function edgeMidpoint(i: number, r: number): { x: number; y: number } {
  const a = polar(cornerAngle(i), r);
  const b = polar(cornerAngle(i + 1), r);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function labelAnchor(angleDeg: number): {
  textAnchor: "start" | "middle" | "end";
  dy: number;
} {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a < 25 || a > 335) return { textAnchor: "middle", dy: -4 };
  if (a >= 25 && a < 155) return { textAnchor: "start", dy: 0 };
  if (a >= 155 && a <= 205) return { textAnchor: "middle", dy: 10 };
  return { textAnchor: "end", dy: 0 };
}

interface DomainRadarProps {
  view: LiveAssetView;
}

export function DomainRadar({ view }: DomainRadarProps) {
  const assetId = view.asset.id;
  const gasSeries = useLiveStore(
    (s) => s.telemetrySeries[`${assetId}::gas_reading`],
  );
  const temp = useLiveStore(
    (s) => s.telemetrySeries[`${assetId}::temp_reading`],
  );
  const vibe = useLiveStore(
    (s) => s.telemetrySeries[`${assetId}::vibration_mm_s`],
  );
  const level = useLiveStore(
    (s) => s.telemetrySeries[`${assetId}::level_pct`],
  );
  const ph = useLiveStore((s) => s.telemetrySeries[`${assetId}::ph`]);
  const wind = useLiveStore((s) => s.telemetrySeries[`${assetId}::wind_ms`]);
  const latest = useLiveStore((s) => s.telemetryLatest[assetId]);

  const extras = useMemo(() => {
    const series = [
      { points: gasSeries, warnAt: 20 },
      { points: temp, warnAt: 80 },
      { points: vibe, warnAt: 7.1 },
      { points: level, warnAt: 95 },
      { points: ph, warnAt: 9 },
      { points: wind, warnAt: 15 },
    ];
    let metricCount = 0;
    let elevatedMetricCount = 0;
    for (const s of series) {
      const last = s.points?.[s.points.length - 1];
      if (last != null) {
        metricCount += 1;
        if (last.v >= s.warnAt) elevatedMetricCount += 1;
      }
    }
    const gasFromTel =
      latest?.payload && typeof latest.payload.gas_reading === "number"
        ? (latest.payload.gas_reading as number)
        : gasSeries?.[gasSeries.length - 1]?.v ?? null;
    return {
      gasPpm: gasFromTel,
      metricCount,
      elevatedMetricCount,
    };
  }, [gasSeries, temp, vibe, level, ph, wind, latest]);

  const scores = useMemo(
    () => computeAllDomainScores(view, extras),
    [view, extras],
  );

  const [hovered, setHovered] = useState<DomainId | null>(null);
  const [pinned, setPinned] = useState<DomainId | null>(null);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const radarWrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const activePreview = pinned ? null : hovered;
  const previewScore: DomainScore | undefined = activePreview
    ? scores.find((s) => s.domain === activePreview)
    : undefined;

  const faces = useMemo(
    () =>
      scores.map((s, i) => {
        const midAngle = edgeMidAngle(i);
        const edge = edgeMidpoint(i, MAX_R);
        const cornerA = polar(cornerAngle(i), MAX_R);
        const cornerB = polar(cornerAngle(i + 1), MAX_R);
        // Push label outward along the side-normal (mid-angle ray).
        const label = polar(
          midAngle,
          Math.hypot(edge.x - CX, edge.y - CY) + LABEL_OUTSET,
        );
        return {
          score: s,
          midAngle,
          tip: polar(midAngle, radiusForScore(s.score, s.empty)),
          edge,
          label,
          cornerA,
          cornerB,
          highlight: facePoints(i, MAX_R),
          hit: facePoints(i, HIT_R),
        };
      }),
    [scores],
  );

  const polygonPoints = useMemo(
    () => faces.map((f) => `${f.tip.x},${f.tip.y}`).join(" "),
    [faces],
  );

  const gridRings = [0.25, 0.5, 0.75, 1];

  const updatePreviewPos = useCallback((clientX: number, clientY: number) => {
    const wrapRect = radarWrapRef.current?.getBoundingClientRect();
    if (!wrapRect) return;
    setPreviewPos({
      x: clientX - wrapRect.left,
      y: clientY - wrapRect.top,
    });
  }, []);

  // Drop pin if that domain no longer has data.
  useEffect(() => {
    if (!pinned) return;
    const score = scores.find((s) => s.domain === pinned);
    if (score?.empty) setPinned(null);
  }, [pinned, scores]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setPinned(null);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setPinned(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [pinned]);

  return (
    <section className={styles.root} ref={rootRef} aria-label="Domain overview">
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Domains</h3>
        <p className={styles.hint}>Grey sides have no data</p>
      </div>

      <div className={styles.radarWrap} ref={radarWrapRef}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label="Pentagon domain radar"
        >
          {/* Corner-based grid (flat sides face domains) */}
          {gridRings.map((t) => {
            const r = MIN_R + t * (MAX_R - MIN_R);
            const pts = Array.from({ length: N }, (_, i) => {
              const p = polar(cornerAngle(i), r);
              return `${p.x},${p.y}`;
            }).join(" ");
            return (
              <polygon
                key={t}
                points={pts}
                className={styles.grid}
                fill="none"
              />
            );
          })}

          {/* Axes toward each side midpoint */}
          {faces.map((f) => {
            const rim = polar(f.midAngle, MAX_R);
            return (
              <line
                key={`axis-${f.score.domain}`}
                x1={CX}
                y1={CY}
                x2={rim.x}
                y2={rim.y}
                className={styles.axis}
              />
            );
          })}

          <polygon points={polygonPoints} className={styles.poly} />

          {/* Side-face highlights */}
          {faces.map((f) => {
            if (f.score.empty) return null;
            const isHot =
              hovered === f.score.domain || pinned === f.score.domain;
            if (!isHot) return null;
            const color = domainPaint(f.score.domain, false);
            return (
              <polygon
                key={`hl-${f.score.domain}`}
                points={f.highlight}
                className={styles.sectorHighlight}
                fill={color}
                stroke={color}
              />
            );
          })}

          {faces.map((f) => {
            const empty = f.score.empty;
            const isHot =
              !empty &&
              (hovered === f.score.domain || pinned === f.score.domain);
            const color = domainPaint(f.score.domain, empty);
            const anchor = labelAnchor(f.midAngle);
            return (
              <g
                key={f.score.domain}
                className={styles.face}
                data-empty={empty ? "true" : undefined}
                data-active={isHot ? "true" : undefined}
              >
                {/* Unavailable side: dashed outer edge as indicator */}
                {empty && (
                  <line
                    x1={f.cornerA.x}
                    y1={f.cornerA.y}
                    x2={f.cornerB.x}
                    y2={f.cornerB.y}
                    className={styles.unavailableEdge}
                  />
                )}
                <line
                  x1={CX}
                  y1={CY}
                  x2={f.tip.x}
                  y2={f.tip.y}
                  stroke={color}
                  strokeWidth={isHot ? 2.25 : 1}
                  opacity={empty ? 0.28 : isHot ? 0.85 : 0.45}
                />
                <circle
                  cx={f.tip.x}
                  cy={f.tip.y}
                  r={empty ? 3 : isHot ? 8 : 5.5}
                  fill={color}
                  className={styles.vertex}
                  data-warn={!empty && f.score.warn ? "true" : undefined}
                  data-empty={empty ? "true" : undefined}
                />
                {isHot && (
                  <line
                    x1={f.cornerA.x}
                    y1={f.cornerA.y}
                    x2={f.cornerB.x}
                    y2={f.cornerB.y}
                    stroke={color}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                )}
                <text
                  x={f.label.x}
                  y={f.label.y + anchor.dy}
                  textAnchor={anchor.textAnchor}
                  dominantBaseline="middle"
                  className={styles.label}
                  data-active={isHot ? "true" : undefined}
                  data-empty={empty ? "true" : undefined}
                  fill={color}
                >
                  {DOMAIN_META[f.score.domain].label}
                </text>
                {empty && (
                  <text
                    x={f.label.x}
                    y={f.label.y + anchor.dy + 11}
                    textAnchor={anchor.textAnchor}
                    dominantBaseline="middle"
                    className={styles.unavailableTag}
                    fill={EMPTY_COLOR}
                  >
                    unavailable
                  </text>
                )}
              </g>
            );
          })}

          {/* Full face hit targets — skip empty domains */}
          {faces.map((f) => {
            if (f.score.empty) {
              return (
                <polygon
                  key={`hit-${f.score.domain}`}
                  points={f.hit}
                  className={styles.sectorHitDisabled}
                  fill="transparent"
                >
                  <title>
                    {DOMAIN_META[f.score.domain].label} — unavailable
                  </title>
                </polygon>
              );
            }
            return (
              <polygon
                key={`hit-${f.score.domain}`}
                points={f.hit}
                className={styles.sectorHit}
                fill="transparent"
                onMouseEnter={(e) => {
                  setHovered(f.score.domain);
                  updatePreviewPos(e.clientX, e.clientY);
                }}
                onMouseMove={(e) => {
                  updatePreviewPos(e.clientX, e.clientY);
                }}
                onMouseLeave={() => {
                  setHovered(null);
                  setPreviewPos(null);
                }}
                onClick={() => {
                  setPinned((prev) =>
                    prev === f.score.domain ? null : f.score.domain,
                  );
                }}
              >
                <title>{DOMAIN_META[f.score.domain].label}</title>
              </polygon>
            );
          })}
        </svg>

        {previewScore && previewPos && (
          <div
            key={previewScore.domain}
            className={styles.preview}
            style={{
              left: Math.min(Math.max(previewPos.x + 12, 8), SIZE - 8),
              top: Math.max(previewPos.y - 8, 8),
            }}
            data-domain={previewScore.domain}
          >
            <p className={styles.previewTitle}>{previewScore.headline}</p>
            <ul className={styles.previewFacts}>
              {previewScore.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <DomainDetailFlyout
        domain={pinned}
        view={view}
        onClose={() => setPinned(null)}
      />
    </section>
  );
}
