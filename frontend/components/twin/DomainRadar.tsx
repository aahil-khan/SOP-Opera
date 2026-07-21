"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveAssetView } from "@/lib/liveStore";
import { useAssetTelemetrySlice, useLiveStore } from "@/lib/liveStore";
import { fetchAssetOwner } from "@/lib/liveApi";
import {
  fetchGraphNeighbors,
  peekGraphNeighborCount,
} from "@/lib/graphNeighborsCache";
import type { AreaOwner } from "@/shared/schemas";
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
/**
 * A regular polygon's corners sit at the ring radius, but the midpoint of a
 * flat side (where axes/score tips point) is closer to center by cos(π/N).
 * Score tips are plotted along that mid-side direction, so their radius must
 * be scaled by this factor or a score of 100 would poke past the outer ring.
 */
const APOTHEM_FACTOR = Math.cos((CORNER_OFFSET * Math.PI) / 180);

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
  const r = empty ? MIN_R * 0.55 : MIN_R + (score / 100) * (MAX_R - MIN_R);
  // Clamp defensively in case an upstream score ever exceeds 0–100.
  return Math.min(r, MAX_R) * APOTHEM_FACTOR;
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
  const detailOwner = view.detail?.area_owner ?? null;

  const { series, latest } = useAssetTelemetrySlice(assetId);
  const gasSeries = series.gas_reading;
  const temp = series.temp_reading;
  const vibe = series.vibration_mm_s;
  const level = series.level_pct;
  const ph = series.ph;
  const wind = series.wind_ms;

  const [neighborCount, setNeighborCount] = useState<number | null>(() =>
    peekGraphNeighborCount(assetId),
  );
  const [fetchedOwner, setFetchedOwner] = useState<AreaOwner | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = peekGraphNeighborCount(assetId);
    if (cached != null) setNeighborCount(cached);
    else setNeighborCount(null);
    void fetchGraphNeighbors(assetId)
      .then((result) => {
        if (!cancelled) setNeighborCount(result.count);
      })
      .catch(() => {
        if (!cancelled) setNeighborCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  // Load zone owner when review detail doesn't include one (e.g. nominal assets).
  useEffect(() => {
    if (detailOwner) {
      setFetchedOwner(null);
      return;
    }
    let cancelled = false;
    setFetchedOwner(null);
    void fetchAssetOwner(assetId)
      .then((owner) => {
        if (!cancelled) setFetchedOwner(owner);
      })
      .catch(() => {
        if (!cancelled) setFetchedOwner(null);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, detailOwner]);

  const areaOwner = detailOwner ?? fetchedOwner;

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
      neighborCount: neighborCount ?? 0,
      spatialPending: neighborCount === null,
      areaOwner,
    };
  }, [
    gasSeries,
    temp,
    vibe,
    level,
    ph,
    wind,
    latest,
    neighborCount,
    areaOwner,
  ]);

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

  // Reset pin when switching assets.
  useEffect(() => {
    setHovered(null);
    setPreviewPos(null);
    setPinned(null);
  }, [assetId]);

  const domainFocusRequest = useLiveStore((s) => s.domainFocusRequest);
  const clearDomainFocusRequest = useLiveStore((s) => s.clearDomainFocusRequest);

  // Map spatial-link pills → pin domain on the pentagon and scroll into view.
  useEffect(() => {
    if (!domainFocusRequest || domainFocusRequest.assetId !== assetId) return;
    const { domain } = domainFocusRequest;
    const score = scores.find((s) => s.domain === domain);
    clearDomainFocusRequest();
    if (score?.empty) return;
    setPinned(domain);
    const scrollRadar = () => {
      rootRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollRadar);
    });
    window.setTimeout(scrollRadar, 50);
    window.setTimeout(scrollRadar, 240);
  }, [domainFocusRequest, assetId, scores, clearDomainFocusRequest]);

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
    <section
      className={styles.root}
      ref={rootRef}
      aria-label="Domain overview"
      data-tour="domain-radar"
    >
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Domains</h3>
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
          {faces.map((f) => (
            <line
              key={`axis-${f.score.domain}`}
              x1={CX}
              y1={CY}
              x2={f.edge.x}
              y2={f.edge.y}
              className={styles.axis}
            />
          ))}

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
        areaOwner={areaOwner}
        onClose={() => setPinned(null)}
      />
    </section>
  );
}
