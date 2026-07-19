"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  useLiveStore,
  type TelemetryMetricKey,
  type TelemetryPoint,
} from "@/lib/liveStore";
import styles from "./AssetTelemetry.module.css";

const GAUGES: {
  key: TelemetryMetricKey;
  label: string;
  unit: string;
  max: number;
  warnAt: number;
}[] = [
  { key: "gas_reading", label: "Gas", unit: "ppm", max: 50, warnAt: 20 },
  { key: "temp_reading", label: "Temperature", unit: "°C", max: 160, warnAt: 80 },
  { key: "vibration_mm_s", label: "Vibration", unit: "mm/s", max: 15, warnAt: 7.1 },
  { key: "level_pct", label: "Level", unit: "%", max: 100, warnAt: 95 },
  { key: "ph", label: "pH", unit: "", max: 14, warnAt: 9 },
  { key: "wind_ms", label: "Wind", unit: "m/s", max: 30, warnAt: 15 },
];

const CHART_W = 280;
const CHART_H = 72;
const PAD = { top: 8, right: 8, bottom: 6, left: 8 };

function formatValue(key: TelemetryMetricKey, v: number): string {
  const digits = key === "vibration_mm_s" || key === "ph" ? 2 : 1;
  return v.toFixed(digits);
}

function formatSampleTime(t: number): string {
  try {
    return new Date(t).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function MiniChart({
  points,
  warnAt,
  maxScale,
  elevated,
  metricKey,
  unit,
}: {
  points: TelemetryPoint[];
  warnAt: number;
  maxScale: number;
  elevated: boolean;
  metricKey: TelemetryMetricKey;
  unit: string;
}) {
  const gradId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const layout = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map((p) => p.v);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    // Keep charts readable: pad range, always include warn line if near scale.
    const pad = Math.max((dataMax - dataMin) * 0.15, maxScale * 0.04, 0.5);
    const yMin = Math.max(0, Math.min(dataMin, warnAt) - pad);
    const yMax = Math.max(dataMax, warnAt, yMin + 0.001) + pad;
    const span = yMax - yMin;

    const plotW = CHART_W - PAD.left - PAD.right;
    const plotH = CHART_H - PAD.top - PAD.bottom;

    const xy = points.map((p, i) => {
      const x = PAD.left + (i / (points.length - 1)) * plotW;
      const y = PAD.top + plotH - ((p.v - yMin) / span) * plotH;
      return { x, y, v: p.v, t: p.t };
    });

    return { yMin, yMax, plotW, plotH, xy, span };
  }, [points, warnAt, maxScale]);

  const pickIndex = useCallback(
    (clientX: number) => {
      if (!layout || !svgRef.current) return null;
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const svgX = ((clientX - rect.left) / rect.width) * CHART_W;
      const { xy } = layout;
      let best = 0;
      let bestDist = Math.abs(xy[0].x - svgX);
      for (let i = 1; i < xy.length; i++) {
        const d = Math.abs(xy[i].x - svgX);
        if (d < bestDist) {
          best = i;
          bestDist = d;
        }
      }
      return best;
    },
    [layout],
  );

  if (!layout) return null;

  const { yMin, yMax, plotW, plotH, xy } = layout;
  const lineD = xy
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const areaD = [
    `M${xy[0].x.toFixed(1)},${(PAD.top + plotH).toFixed(1)}`,
    ...xy.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L${xy[xy.length - 1].x.toFixed(1)},${(PAD.top + plotH).toFixed(1)}`,
    "Z",
  ].join(" ");

  const warnY = PAD.top + plotH - ((warnAt - yMin) / layout.span) * plotH;
  const warnInView = warnAt >= yMin && warnAt <= yMax;
  const last = xy[xy.length - 1];
  const gridYs = [0.25, 0.5, 0.75].map((t) => PAD.top + plotH * t);
  const hover = hoverIdx != null ? xy[hoverIdx] : null;
  const tipLeftPct = hover
    ? Math.min(92, Math.max(8, (hover.x / CHART_W) * 100))
    : 50;

  return (
    <div
      className={styles.chartFrame}
      data-risk={elevated ? "elevated" : "nominal"}
      data-hovering={hover ? "true" : undefined}
    >
      <div className={styles.chartPlotWrap}>
        <svg
          ref={svgRef}
          className={styles.chart}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          role="img"
          aria-label="Telemetry trend"
          preserveAspectRatio="none"
          onMouseMove={(e) => {
            const idx = pickIndex(e.clientX);
            if (idx != null) setHoverIdx(idx);
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id={`fill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="currentColor"
                stopOpacity={elevated ? 0.35 : 0.28}
              />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Plot background */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            className={styles.chartPlot}
          />

          {/* Horizontal grid */}
          {gridYs.map((y) => (
            <line
              key={y}
              x1={PAD.left}
              y1={y}
              x2={PAD.left + plotW}
              y2={y}
              className={styles.chartGrid}
            />
          ))}

          {/* Warn threshold */}
          {warnInView && (
            <g>
              <line
                x1={PAD.left}
                y1={warnY}
                x2={PAD.left + plotW}
                y2={warnY}
                className={styles.chartWarn}
              />
            </g>
          )}

          <path d={areaD} fill={`url(#fill-${gradId})`} />
          <path
            d={lineD}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Latest sample marker — hide when scrubbing so hover point is clear */}
          {!hover && (
            <>
              <circle
                cx={last.x}
                cy={last.y}
                r="3.5"
                className={styles.chartDot}
                fill="currentColor"
              />
              <circle
                cx={last.x}
                cy={last.y}
                r="6"
                fill="currentColor"
                opacity="0.2"
              />
            </>
          )}

          {hover && (
            <g className={styles.chartScrub} pointerEvents="none">
              <line
                x1={hover.x}
                y1={PAD.top}
                x2={hover.x}
                y2={PAD.top + plotH}
                className={styles.chartScrubLine}
              />
              <circle
                cx={hover.x}
                cy={hover.y}
                r="5"
                className={styles.chartDot}
                fill="currentColor"
              />
              <circle
                cx={hover.x}
                cy={hover.y}
                r="8"
                fill="currentColor"
                opacity="0.22"
              />
            </g>
          )}

          {/* Invisible hit surface so the whole plot is scrubbable */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            className={styles.chartHit}
          />
        </svg>

        {hover && (
          <div
            className={styles.chartTip}
            style={{ left: `${tipLeftPct}%` }}
            role="status"
          >
            <strong>
              {formatValue(metricKey, hover.v)}
              {unit ? ` ${unit}` : ""}
            </strong>
            <span>{formatSampleTime(hover.t)}</span>
          </div>
        )}
      </div>
      <div className={styles.chartAxis}>
        <span>{yMax.toFixed(yMax >= 100 ? 0 : 1)}</span>
        <span className={styles.chartAxisMid}>trend</span>
        <span>{yMin.toFixed(yMin >= 100 ? 0 : 1)}</span>
      </div>
    </div>
  );
}

interface AssetTelemetryProps {
  assetId: string;
  /** When true, omit the outer section heading (used inside DomainDetailFlyout). */
  embedded?: boolean;
}

export function AssetTelemetry({
  assetId,
  embedded = false,
}: AssetTelemetryProps) {
  const gas = useLiveStore((s) => s.telemetrySeries[`${assetId}::gas_reading`]);
  const temp = useLiveStore((s) => s.telemetrySeries[`${assetId}::temp_reading`]);
  const vibe = useLiveStore(
    (s) => s.telemetrySeries[`${assetId}::vibration_mm_s`],
  );
  const level = useLiveStore((s) => s.telemetrySeries[`${assetId}::level_pct`]);
  const ph = useLiveStore((s) => s.telemetrySeries[`${assetId}::ph`]);
  const wind = useLiveStore((s) => s.telemetrySeries[`${assetId}::wind_ms`]);
  const assetStatusSig = useLiveStore((s) =>
    s.telemetryStatus
      .filter((c) => c.asset_id === assetId)
      .map((c) => `${c.category}:${c.label}:${c.ts}`)
      .join("|"),
  );
  const assetStatus = useMemo(() => {
    void assetStatusSig;
    return useLiveStore
      .getState()
      .telemetryStatus.filter((c) => c.asset_id === assetId);
  }, [assetId, assetStatusSig]);

  const seriesMap: Record<string, TelemetryPoint[] | undefined> = {
    gas_reading: gas,
    temp_reading: temp,
    vibration_mm_s: vibe,
    level_pct: level,
    ph,
    wind_ms: wind,
  };

  const gauges = GAUGES.map((g) => {
    const points = seriesMap[g.key] ?? [];
    const last = points[points.length - 1];
    return { ...g, points, value: last?.v ?? null };
  }).filter((g) => g.value != null || g.points.length > 0);

  const heading = !embedded ? (
    <h3 id="telemetry-heading" className={styles.sectionTitle}>
      Live telemetry
    </h3>
  ) : null;

  if (gauges.length === 0 && assetStatus.length === 0) {
    return (
      <section
        className={styles.section}
        aria-labelledby={embedded ? undefined : "telemetry-heading"}
      >
        {heading}
        <p className={styles.muted}>Waiting for ambient plant feed…</p>
      </section>
    );
  }

  return (
    <section
      className={styles.section}
      aria-labelledby={embedded ? undefined : "telemetry-heading"}
      aria-label={embedded ? "Live telemetry" : undefined}
    >
      {heading}
      <div className={styles.gaugeGrid}>
        {gauges.map((g) => {
          const elevated = g.value != null && g.value >= g.warnAt;
          return (
            <article
              key={g.key}
              className={styles.gauge}
              data-risk={elevated ? "elevated" : "nominal"}
            >
              <div className={styles.gaugeHead}>
                <div className={styles.gaugeTitle}>
                  <span className={styles.gaugeLabel}>{g.label}</span>
                  <span className={styles.gaugeMeta}>
                    {g.points.length} samples · warn ≥ {formatValue(g.key, g.warnAt)}
                    {g.unit ? ` ${g.unit}` : ""}
                  </span>
                </div>
                <div className={styles.gaugeValue}>
                  <strong>
                    {g.value != null ? formatValue(g.key, g.value) : "—"}
                  </strong>
                  {g.unit ? <span className={styles.unit}>{g.unit}</span> : null}
                </div>
              </div>
              <MiniChart
                points={g.points}
                warnAt={g.warnAt}
                maxScale={g.max}
                elevated={elevated}
                metricKey={g.key}
                unit={g.unit}
              />
            </article>
          );
        })}
      </div>
      {assetStatus.length > 0 ? (
        <div className={styles.chips}>
          {assetStatus.map((c) => (
            <span key={`${c.category}-${c.ts}`} className={styles.chip}>
              <span className={styles.chipSrc}>{c.source}</span>
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
