import type { TelemetryMetricKey } from "@/lib/liveStore";

export type SensorRiskBand = "nominal" | "elevated" | "critical";

export interface SensorBandThresholds {
  elevated: number;
  critical: number;
}

export interface RuleThresholds {
  vibration_anomaly_threshold: number;
  effluent_ph_min: number;
  effluent_ph_max: number;
  tank_level_high_pct: number;
  tank_level_low_pct: number;
  weather_wind_hold_ms: number;
  cert_expiry_warning_days: number;
}

export interface ThresholdsConfig {
  sensors: Partial<Record<TelemetryMetricKey, SensorBandThresholds>>;
  rules: RuleThresholds;
}

/** Fallback when API has not loaded yet — mirrors backend Settings defaults. */
export const DEFAULT_THRESHOLDS: ThresholdsConfig = {
  sensors: {
    gas_reading: { elevated: 20, critical: 50 },
    temp_reading: { elevated: 80, critical: 120 },
  },
  rules: {
    vibration_anomaly_threshold: 7.1,
    effluent_ph_min: 6.0,
    effluent_ph_max: 9.0,
    tank_level_high_pct: 95.0,
    tank_level_low_pct: 5.0,
    weather_wind_hold_ms: 15.0,
    cert_expiry_warning_days: 14,
  },
};

export const CRITICAL_SENSOR_FACT_TYPES = new Set([
  "critical_gas",
  "critical_temperature",
]);

export function metricElevatedAt(
  metric: TelemetryMetricKey,
  config: ThresholdsConfig = DEFAULT_THRESHOLDS,
): number | undefined {
  const band = config.sensors[metric];
  if (band) {
    return band.elevated;
  }
  switch (metric) {
    case "vibration_mm_s":
      return config.rules.vibration_anomaly_threshold;
    case "level_pct":
      return config.rules.tank_level_high_pct;
    case "ph":
      return config.rules.effluent_ph_max;
    case "wind_ms":
      return config.rules.weather_wind_hold_ms;
    default:
      return undefined;
  }
}

export function metricCriticalAt(
  metric: TelemetryMetricKey,
  config: ThresholdsConfig = DEFAULT_THRESHOLDS,
): number | undefined {
  return config.sensors[metric]?.critical;
}

export function sensorRiskBand(
  metric: TelemetryMetricKey,
  value: number,
  config: ThresholdsConfig = DEFAULT_THRESHOLDS,
): SensorRiskBand {
  const bands = config.sensors[metric];
  if (!bands) {
    return "nominal";
  }
  if (value >= bands.critical) {
    return "critical";
  }
  if (value >= bands.elevated) {
    return "elevated";
  }
  return "nominal";
}

/** Open-work display risk: sensor incident overrides compound blocking label. */
export function openWorkDisplayRisk(
  riskLevel: string,
  sensorCritical: boolean,
): "nominal" | "elevated" | "blocking" | "critical" {
  if (sensorCritical) {
    return "critical";
  }
  if (riskLevel === "elevated" || riskLevel === "blocking" || riskLevel === "nominal") {
    return riskLevel;
  }
  return "nominal";
}

export function assetHasSensorCritical(
  assetId: string,
  derivedFacts:
    | { fact_type: string; value: boolean | string | number }[]
    | undefined,
  telemetrySeries: Record<string, { v: number }[]>,
  telemetryLatest: Record<string, { asset_id: string; payload: Record<string, unknown> }>,
  config: ThresholdsConfig = DEFAULT_THRESHOLDS,
): boolean {
  if (
    derivedFacts?.some(
      (f) =>
        CRITICAL_SENSOR_FACT_TYPES.has(f.fact_type) &&
        (f.value === true || f.value === "true"),
    )
  ) {
    return true;
  }
  for (const [metric, bands] of Object.entries(config.sensors) as [
    TelemetryMetricKey,
    SensorBandThresholds,
  ][]) {
    const points = telemetrySeries[`${assetId}::${metric}`];
    const last = points?.[points.length - 1]?.v;
    if (typeof last === "number" && last >= bands.critical) {
      return true;
    }
    const latest = telemetryLatest[assetId];
    if (latest?.asset_id === assetId) {
      const raw = latest.payload[metric];
      if (typeof raw === "number" && raw >= bands.critical) {
        return true;
      }
    }
  }
  return false;
}
