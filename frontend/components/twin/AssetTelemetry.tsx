"use client";

import { useMemo } from "react";
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
  { key: "temp_reading", label: "Temp", unit: "°C", max: 160, warnAt: 80 },
  { key: "vibration_mm_s", label: "Vibration", unit: "mm/s", max: 15, warnAt: 7.1 },
  { key: "level_pct", label: "Level", unit: "%", max: 100, warnAt: 95 },
  { key: "ph", label: "pH", unit: "", max: 14, warnAt: 9 },
  { key: "wind_ms", label: "Wind", unit: "m/s", max: 30, warnAt: 15 },
];

function Sparkline({ points }: { points: TelemetryPoint[] }) {
  if (points.length < 2) {
    return <div className={styles.sparkEmpty} />;
  }
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.001);
  const w = 120;
  const h = 28;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.v - min) / span) * (h - 2) - 1;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={styles.spark} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GaugeBar({
  value,
  max,
  warnAt,
}: {
  value: number;
  max: number;
  warnAt: number;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const warnPct = Math.min(100, (warnAt / max) * 100);
  const elevated = value >= warnAt;
  return (
    <div className={styles.barTrack} aria-hidden>
      <div
        className={styles.barFill}
        data-risk={elevated ? "elevated" : "nominal"}
        style={{ width: `${pct}%` }}
      />
      <span className={styles.barWarn} style={{ left: `${warnPct}%` }} />
    </div>
  );
}

interface AssetTelemetryProps {
  assetId: string;
}

export function AssetTelemetry({ assetId }: AssetTelemetryProps) {
  // Narrow selectors — avoid re-rendering on every plant-wide sample
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

  if (gauges.length === 0 && assetStatus.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="telemetry-heading">
        <h3 id="telemetry-heading" className={styles.sectionTitle}>
          Live telemetry
        </h3>
        <p className={styles.muted}>Waiting for ambient plant feed…</p>
      </section>
    );
  }

  return (
    <section className={styles.section} aria-labelledby="telemetry-heading">
      <h3 id="telemetry-heading" className={styles.sectionTitle}>
        Live telemetry
      </h3>
      <div className={styles.gaugeGrid}>
        {gauges.map((g) => (
          <div key={g.key} className={styles.gauge}>
            <div className={styles.gaugeHead}>
              <span>{g.label}</span>
              <strong>
                {g.value != null ? g.value.toFixed(g.key === "vibration_mm_s" || g.key === "ph" ? 2 : 1) : "—"}
                {g.unit ? ` ${g.unit}` : ""}
              </strong>
            </div>
            {g.value != null ? (
              <GaugeBar value={g.value} max={g.max} warnAt={g.warnAt} />
            ) : null}
            <Sparkline points={g.points} />
          </div>
        ))}
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
