import type { AssessmentHistoryItem } from "@/lib/liveApi";
import type { AgentStepEvent } from "@/lib/liveStore";

export interface TrendForecastView {
  metric: string;
  slopePerMin: number | null;
  rSquared: number | null;
  etaElevated: string | null;
  etaCritical: string | null;
  /** Fallback prose when structured fields are unavailable. */
  summary: string;
}

const METRIC_LABELS: Record<string, string> = {
  gas_reading: "Gas",
  temp_reading: "Temperature",
  vibration_mm_s: "Vibration",
};

function humanize(value: string): string {
  return METRIC_LABELS[value] ?? value.replaceAll("_", " ");
}

function formatEta(seconds: unknown): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  if (seconds <= 0) return "now";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  return mins === 1 ? "~1 min" : `~${mins} min`;
}

function pickTopForecast(
  forecasts: unknown,
): Record<string, unknown> | null {
  if (!Array.isArray(forecasts) || forecasts.length === 0) return null;
  const ranked = forecasts
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .filter(
      (f) =>
        typeof f.seconds_to_critical === "number" ||
        typeof f.seconds_to_elevated === "number",
    )
    .sort((a, b) => {
      const aCrit =
        typeof a.seconds_to_critical === "number"
          ? a.seconds_to_critical
          : 1e9;
      const bCrit =
        typeof b.seconds_to_critical === "number"
          ? b.seconds_to_critical
          : 1e9;
      return aCrit - bCrit;
    });
  return ranked[0] ?? null;
}

function fromForecastDict(
  f: Record<string, unknown>,
  fallbackSummary?: string,
): TrendForecastView {
  const metric =
    typeof f.metric === "string" ? humanize(f.metric) : "Sensor";
  const slope =
    typeof f.slope_per_min === "number" && Number.isFinite(f.slope_per_min)
      ? f.slope_per_min
      : null;
  const r2 =
    typeof f.r_squared === "number" && Number.isFinite(f.r_squared)
      ? f.r_squared
      : null;
  const etaElevated = formatEta(f.seconds_to_elevated);
  const etaCritical = formatEta(f.seconds_to_critical);
  const parts: string[] = [];
  if (slope != null) parts.push(`${metric} rising ${slope.toFixed(1)}/min`);
  if (r2 != null) parts.push(`R²=${r2.toFixed(2)}`);
  if (etaCritical) parts.push(`critical ${etaCritical}`);
  return {
    metric,
    slopePerMin: slope,
    rSquared: r2,
    etaElevated,
    etaCritical,
    summary: fallbackSummary?.trim() || parts.join(" · ") || `${metric} trend rising`,
  };
}

function parseProse(message: string): TrendForecastView {
  const slopeMatch = message.match(/rising\s+([\d.]+)\/min/i);
  const r2Match = message.match(/R[²2]=([\d.]+)/i);
  const elevMatch = message.match(/elevated in ([^,\s]+(?:\s+min)?)/i);
  const critMatch = message.match(/critical in ([^,\s]+(?:\s+min)?)/i);
  const metricMatch = message.match(
    /^(Gas|Temperature|Vibration|[A-Za-z ]+?)\s+rising/i,
  );
  return {
    metric: metricMatch?.[1]?.trim() || "Sensor",
    slopePerMin: slopeMatch ? Number(slopeMatch[1]) : null,
    rSquared: r2Match ? Number(r2Match[1]) : null,
    etaElevated: elevMatch?.[1] ?? null,
    etaCritical: critMatch?.[1] ?? null,
    summary: message.trim(),
  };
}

function forecastsFromTrace(trace: unknown[]): Record<string, unknown> | null {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const step = trace[i];
    if (!step || typeof step !== "object") continue;
    const row = step as Record<string, unknown>;
    const detail =
      row.detail && typeof row.detail === "object"
        ? (row.detail as Record<string, unknown>)
        : null;
    if (!detail) continue;

    if (row.agent === "orchestrator" && row.kind === "verdict") {
      const top = pickTopForecast(detail.trend_forecasts);
      if (top) return top;
    }
    if (row.agent === "predictive_trend") {
      const top = pickTopForecast(detail.forecasts ?? detail.trend_forecasts);
      if (top) return top;
    }
  }
  return null;
}

function riskObservationMessage(trace: unknown[]): string | null {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const step = trace[i];
    if (!step || typeof step !== "object") continue;
    const row = step as Record<string, unknown>;
    if (row.agent !== "predictive_trend" || row.kind !== "observation") continue;
    if (row.finding !== "risk") continue;
    if (typeof row.message === "string" && row.message.trim()) {
      return row.message.trim();
    }
  }
  return null;
}

function fromAssessment(
  assessment: AssessmentHistoryItem | null,
): TrendForecastView | null {
  if (!assessment) return null;

  const factors =
    assessment.reasoning_factors ??
    assessment.metadata?.reasoning_factors ??
    [];
  const factor = factors.find((f) => f.fact_type === "predicted_trend_risk");

  const trace =
    assessment.agent_trace ??
    (assessment.metadata as { agent_trace?: unknown[] } | null)?.agent_trace ??
    [];
  const traceList = Array.isArray(trace) ? trace : [];
  const top = forecastsFromTrace(traceList);
  const message = riskObservationMessage(traceList) ?? factor?.detail ?? null;

  if (top) return fromForecastDict(top, message ?? undefined);
  if (message) return parseProse(message);
  return null;
}

function fromLiveSteps(steps: AgentStepEvent[]): TrendForecastView | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step.agent !== "predictive_trend" || step.kind !== "observation") continue;
    if (step.finding !== "risk") continue;

    const detail = step.detail;
    const top = pickTopForecast(detail?.forecasts ?? detail?.trend_forecasts);
    if (top) return fromForecastDict(top, step.message);
    if (step.message.trim()) return parseProse(step.message);
  }
  return null;
}

export function trendForecastForAssessment(
  assessment: AssessmentHistoryItem | null,
  liveSteps: AgentStepEvent[] = [],
): TrendForecastView | null {
  return fromAssessment(assessment) ?? fromLiveSteps(liveSteps);
}
