"use client";

import { useMemo, useState } from "react";
import {
  useLiveStore,
  type TelemetryMetricKey,
  type TelemetrySample,
} from "@/lib/liveStore";
import styles from "./TelemetryStrip.module.css";

const SOURCES = [
  { id: "scada", label: "SCADA" },
  { id: "ptw", label: "PTW" },
  { id: "maintenance", label: "Maint" },
  { id: "workforce", label: "Workforce" },
] as const;

const METRIC_META: Record<
  TelemetryMetricKey,
  { label: string; unit: string; warnAt?: number }
> = {
  gas_reading: { label: "Gas", unit: "ppm", warnAt: 20 },
  temp_reading: { label: "Temp", unit: "°C", warnAt: 80 },
  vibration_mm_s: { label: "Vibe", unit: "mm/s", warnAt: 7.1 },
  level_pct: { label: "Level", unit: "%" },
  ph: { label: "pH", unit: "" },
  wind_ms: { label: "Wind", unit: "m/s", warnAt: 15 },
};

function latestNumericAcrossPlant(
  bySource: Record<string, TelemetrySample>,
  source: string,
  metric: TelemetryMetricKey,
): { value: number; asset?: string } | null {
  let best: { value: number; asset?: string; t: number } | null = null;
  const preferMax = [
    "gas_reading",
    "temp_reading",
    "vibration_mm_s",
    "wind_ms",
  ].includes(metric);
  for (const [key, sample] of Object.entries(bySource)) {
    if (!key.startsWith(`${source}:`)) continue;
    const raw = sample.payload[metric];
    if (typeof raw !== "number") continue;
    const t = Date.parse(sample.ts) || 0;
    if (
      !best ||
      (preferMax ? raw > best.value : t > best.t) ||
      (preferMax && raw === best.value && t > best.t)
    ) {
      best = { value: raw, asset: sample.asset_name, t };
    }
  }
  return best ? { value: best.value, asset: best.asset } : null;
}

function countActivePermits(status: { category: string; label: string }[]): number {
  return status.filter(
    (s) => s.category === "permit" && s.label.toLowerCase().includes("active"),
  ).length;
}

function countHazardousWorkers(status: { category: string; label: string }[]): number {
  return status.filter(
    (s) =>
      s.category === "worker_location" &&
      s.label.toLowerCase().includes("hazardous"),
  ).length;
}

interface TelemetryStripProps {
  shiftForDrawer?: boolean;
}

export function TelemetryStrip({ shiftForDrawer = false }: TelemetryStripProps) {
  const bySource = useLiveStore((s) => s.telemetryBySource);
  const status = useLiveStore((s) => s.telemetryStatus);
  const [source, setSource] = useState<(typeof SOURCES)[number]["id"]>("scada");

  const cards = useMemo(() => {
    if (source === "scada") {
      return (["gas_reading", "temp_reading", "vibration_mm_s", "wind_ms"] as const).map(
        (metric) => {
          const hit = latestNumericAcrossPlant(bySource, "scada", metric);
          const meta = METRIC_META[metric];
          const elevated =
            hit != null && meta.warnAt != null && hit.value >= meta.warnAt;
          return {
            key: metric,
            label: meta.label,
            value: hit ? hit.value.toFixed(metric === "vibration_mm_s" ? 2 : 1) : "—",
            unit: meta.unit,
            hint: hit?.asset,
            risk: elevated ? "elevated" : "nominal",
          };
        },
      );
    }
    if (source === "ptw") {
      return [
        {
          key: "permits",
          label: "Active permits",
          value: String(countActivePermits(status)),
          unit: "",
          hint: "plant-wide",
          risk: countActivePermits(status) > 1 ? "elevated" : "nominal",
        },
      ];
    }
    if (source === "maintenance") {
      const incomplete = status.filter(
        (s) =>
          s.category === "isolation_status" &&
          s.label.toLowerCase().includes("incomplete"),
      ).length;
      return [
        {
          key: "iso",
          label: "Isolation flags",
          value: String(incomplete),
          unit: "",
          hint: incomplete ? "check assets" : "nominal",
          risk: incomplete ? "elevated" : "nominal",
        },
      ];
    }
    return [
      {
        key: "zone",
        label: "In hazardous zone",
        value: String(countHazardousWorkers(status)),
        unit: "",
        hint: "workforce",
        risk: countHazardousWorkers(status) > 0 ? "elevated" : "nominal",
      },
    ];
  }, [bySource, source, status]);

  const sampleCount = Object.keys(bySource).length;

  return (
    <div
      className={styles.strip}
      data-shift={shiftForDrawer ? "true" : undefined}
      role="region"
      aria-label="Live plant telemetry"
    >
      <div className={styles.header}>
        <span className={styles.mark}>Live</span>
        <span className={styles.title}>Plant feed</span>
        <span className={styles.pulse} data-live={sampleCount > 0 ? "true" : undefined} />
        <div className={styles.tabs} role="tablist" aria-label="Source">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={source === s.id}
              className={styles.tab}
              data-active={source === s.id ? "true" : undefined}
              onClick={() => setSource(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.cards}>
        {cards.map((c) => (
          <div key={c.key} className={styles.card} data-risk={c.risk}>
            <span className={styles.cardLabel}>{c.label}</span>
            <span className={styles.cardValue}>
              {c.value}
              {c.unit ? <span className={styles.unit}>{c.unit}</span> : null}
            </span>
            {c.hint ? <span className={styles.hint}>{c.hint}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
