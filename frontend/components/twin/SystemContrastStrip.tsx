"use client";

import { useMemo } from "react";
import {
  useLiveStore,
  type LiveAssetView,
  type TelemetrySample,
} from "@/lib/liveStore";
import { sensorRiskBand } from "@/lib/sensorThresholds";
import { isBlockedWork, isElevatedOrBlocking } from "@/lib/openWork";
import styles from "./SystemContrastStrip.module.css";

const EMPTY_BY_SOURCE: Record<string, TelemetrySample> = {};

/** Peak plant gas reading across SCADA telemetry (single-sensor alarm view). */
function peakGas(
  bySource: Record<string, TelemetrySample>,
): number | null {
  let peak: number | null = null;
  for (const [key, sample] of Object.entries(bySource)) {
    if (!key.startsWith("scada:")) continue;
    const raw = sample.payload.gas_reading;
    if (typeof raw !== "number") continue;
    if (peak === null || raw > peak) peak = raw;
  }
  return peak;
}

interface Cell {
  system: string;
  state: string;
  /** "quiet" = this system's own alarm is silent; "alarm" = it would fire. */
  tone: "quiet" | "warn" | "alarm";
}

/**
 * Moment A — multi-system blindness. Each upstream system reports through its OWN
 * alarm logic: SCADA's single-sensor alarm stays silent below the critical line even
 * as gas climbs; a valid permit and in-progress maintenance are not alarms; a worker on
 * site is not an alarm. None of them fire — yet SOP Opera fuses them into a BLOCK. That
 * contrast, in one glance, is the whole product thesis.
 */
export function SystemContrastStrip({ views }: { views: LiveAssetView[] }) {
  const opsSummary = useLiveStore((s) => s.opsSummary);
  const thresholdsConfig = useLiveStore((s) => s.thresholdsConfig);
  const bySource = useLiveStore((s) => s.telemetryBySource ?? EMPTY_BY_SOURCE);

  const gas = useMemo(() => peakGas(bySource), [bySource]);

  const verdict: "blocking" | "elevated" | "nominal" = useMemo(() => {
    if (views.some((v) => isBlockedWork(v))) return "blocking";
    if (views.some((v) => isElevatedOrBlocking(v))) return "elevated";
    return "nominal";
  }, [views]);

  // A conventional single-sensor SCADA alarm fires only at the CRITICAL line — below
  // it, SCADA is silent even while gas is elevated. That silence is the point.
  const gasBand =
    gas !== null ? sensorRiskBand("gas_reading", gas, thresholdsConfig) : "nominal";
  const scadaAlarming = gasBand === "critical";

  const upstream: Cell[] = [
    {
      system: "SCADA",
      state:
        gas !== null
          ? scadaAlarming
            ? `Gas ALARM · ${gas.toFixed(0)} ppm`
            : `No alarm · ${gas.toFixed(0)} ppm`
          : "No alarm",
      tone: scadaAlarming ? "alarm" : "quiet",
    },
    {
      system: "Permit to Work",
      state:
        opsSummary.activePermits > 0
          ? `Valid · ${opsSummary.activePermits} active`
          : "No open permit",
      tone: "quiet",
    },
    {
      system: "Maintenance",
      state:
        opsSummary.incompleteIsolations > 0 ? "In progress" : "No open work",
      tone: opsSummary.incompleteIsolations > 0 ? "warn" : "quiet",
    },
    {
      system: "Workforce",
      state:
        opsSummary.peopleAtRisk > 0
          ? `On site · ${opsSummary.peopleAtRisk}`
          : "Clear",
      tone: opsSummary.peopleAtRisk > 0 ? "warn" : "quiet",
    },
  ];

  const verdictLabel =
    verdict === "blocking"
      ? "BLOCK"
      : verdict === "elevated"
        ? "ELEVATED"
        : "CLEAR";

  return (
    <div className={styles.strip} role="group" aria-label="Cross-system risk contrast">
      {upstream.map((c) => (
        <div key={c.system} className={styles.cell} data-tone={c.tone}>
          <span className={styles.system}>{c.system}</span>
          <span className={styles.state}>{c.state}</span>
        </div>
      ))}
      <div className={styles.arrow} aria-hidden>
        →
      </div>
      <div className={styles.verdict} data-risk={verdict}>
        <span className={styles.system}>SOP Opera</span>
        <span className={styles.verdictLabel}>{verdictLabel}</span>
      </div>
    </div>
  );
}
