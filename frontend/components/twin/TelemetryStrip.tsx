"use client";

import { useMemo, useState } from "react";
import {
  useLiveStore,
  type TelemetryMetricKey,
  type TelemetrySample,
} from "@/lib/liveStore";
import { sensorRiskBand } from "@/lib/sensorThresholds";
import styles from "./TelemetryStrip.module.css";

const SOURCES = [
  { id: "scada", label: "SCADA" },
  { id: "ptw", label: "Permit to Work" },
  { id: "maintenance", label: "Maintenance" },
  { id: "workforce", label: "Workforce" },
] as const;

const METRIC_META: Record<
  TelemetryMetricKey,
  { label: string; unit: string }
> = {
  gas_reading: { label: "Gas", unit: "ppm" },
  temp_reading: { label: "Temperature", unit: "°C" },
  vibration_mm_s: { label: "Vibration", unit: "mm/s" },
  level_pct: { label: "Level", unit: "%" },
  ph: { label: "pH", unit: "" },
  wind_ms: { label: "Wind", unit: "m/s" },
};

const EMPTY_BY_SOURCE: Record<string, TelemetrySample> = {};

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

interface TelemetryStripProps {
  shiftForDrawer?: boolean;
}

export function TelemetryStrip({ shiftForDrawer = false }: TelemetryStripProps) {
  const [source, setSource] = useState<(typeof SOURCES)[number]["id"]>("scada");
  const opsSummary = useLiveStore((s) => s.opsSummary);
  const thresholdsConfig = useLiveStore((s) => s.thresholdsConfig);
  /** Only subscribe to bySource while the SCADA tab is active. */
  const bySource = useLiveStore((s) =>
    source === "scada" ? s.telemetryBySource : EMPTY_BY_SOURCE,
  );
  const hasLiveFeed = useLiveStore((s) => s.opsSummary.assetsWithOps > 0);

  const cards = useMemo(() => {
    if (source === "scada") {
      return (["gas_reading", "temp_reading", "vibration_mm_s", "wind_ms"] as const).map(
        (metric) => {
          const hit = latestNumericAcrossPlant(bySource, "scada", metric);
          const meta = METRIC_META[metric];
          const band =
            hit != null
              ? sensorRiskBand(metric, hit.value, thresholdsConfig)
              : "nominal";
          return {
            key: metric,
            label: meta.label,
            value: hit ? hit.value.toFixed(metric === "vibration_mm_s" ? 2 : 1) : "—",
            unit: meta.unit,
            hint: hit?.asset,
            risk: band,
          };
        },
      );
    }
    if (source === "ptw") {
      return [
        {
          key: "permits",
          label: "Active permits",
          value: String(opsSummary.activePermits),
          unit: "",
          hint: "plant-wide",
          risk: opsSummary.activePermits > 1 ? "elevated" : "nominal",
        },
      ];
    }
    if (source === "maintenance") {
      return [
        {
          key: "iso",
          label: "Isolation flags",
          value: String(opsSummary.incompleteIsolations),
          unit: "",
          hint: opsSummary.incompleteIsolations ? "check assets" : "nominal",
          risk: opsSummary.incompleteIsolations ? "elevated" : "nominal",
        },
      ];
    }
    return [
      {
        key: "zone",
        label: "In hazardous zone",
        value: String(opsSummary.peopleAtRisk),
        unit: "",
        hint: "workforce",
        risk: opsSummary.peopleAtRisk > 0 ? "elevated" : "nominal",
      },
    ];
  }, [bySource, source, opsSummary, thresholdsConfig]);

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
        <span className={styles.pulse} data-live={hasLiveFeed ? "true" : undefined} />
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
            <span className={styles.cardLabel}>
              {c.label}
              {c.risk === "critical" ? (
                <span className={styles.criticalFlag}>CRITICAL</span>
              ) : null}
            </span>
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
