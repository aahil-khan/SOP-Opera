"use client";

import { useEffect, useState } from "react";
import { putThresholds } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import {
  DEFAULT_THRESHOLDS,
  type ThresholdsConfig,
} from "@/lib/sensorThresholds";
import styles from "./ThresholdEditor.module.css";

type Draft = {
  gasElevated: string;
  gasCritical: string;
  tempElevated: string;
  tempCritical: string;
  vibrationAnomaly: string;
  effluentPhMin: string;
  effluentPhMax: string;
  tankLevelHighPct: string;
  tankLevelLowPct: string;
  weatherWindHoldMs: string;
  certExpiryWarningDays: string;
};

function draftFromConfig(config: ThresholdsConfig): Draft {
  const gas = {
    ...DEFAULT_THRESHOLDS.sensors.gas_reading!,
    ...config.sensors?.gas_reading,
  };
  const temp = {
    ...DEFAULT_THRESHOLDS.sensors.temp_reading!,
    ...config.sensors?.temp_reading,
  };
  const rules = {
    ...DEFAULT_THRESHOLDS.rules,
    ...config.rules,
  };

  return {
    gasElevated: String(gas.elevated),
    gasCritical: String(gas.critical),
    tempElevated: String(temp.elevated),
    tempCritical: String(temp.critical),
    vibrationAnomaly: String(rules.vibration_anomaly_threshold),
    effluentPhMin: String(rules.effluent_ph_min),
    effluentPhMax: String(rules.effluent_ph_max),
    tankLevelHighPct: String(rules.tank_level_high_pct),
    tankLevelLowPct: String(rules.tank_level_low_pct),
    weatherWindHoldMs: String(rules.weather_wind_hold_ms),
    certExpiryWarningDays: String(rules.cert_expiry_warning_days),
  };
}

function defaultDraft(): Draft {
  return draftFromConfig(DEFAULT_THRESHOLDS);
}

function parseDraft(draft: Draft): ThresholdsConfig | string {
  const gasElevated = Number(draft.gasElevated);
  const gasCritical = Number(draft.gasCritical);
  const tempElevated = Number(draft.tempElevated);
  const tempCritical = Number(draft.tempCritical);
  const vibrationAnomaly = Number(draft.vibrationAnomaly);
  const effluentPhMin = Number(draft.effluentPhMin);
  const effluentPhMax = Number(draft.effluentPhMax);
  const tankLevelHighPct = Number(draft.tankLevelHighPct);
  const tankLevelLowPct = Number(draft.tankLevelLowPct);
  const weatherWindHoldMs = Number(draft.weatherWindHoldMs);
  const certExpiryWarningDays = Number(draft.certExpiryWarningDays);

  const nums = [
    gasElevated,
    gasCritical,
    tempElevated,
    tempCritical,
    vibrationAnomaly,
    effluentPhMin,
    effluentPhMax,
    tankLevelHighPct,
    tankLevelLowPct,
    weatherWindHoldMs,
    certExpiryWarningDays,
  ];
  if (nums.some((n) => !Number.isFinite(n))) {
    return "All values must be numbers.";
  }
  if (!Number.isInteger(certExpiryWarningDays) || certExpiryWarningDays < 0) {
    return "Cert expiry warning must be a whole number ≥ 0.";
  }
  if (gasCritical <= gasElevated || tempCritical <= tempElevated) {
    return "Critical must be greater than elevated for gas and temperature.";
  }
  if (effluentPhMax <= effluentPhMin) {
    return "Effluent pH max must be greater than min.";
  }
  if (tankLevelHighPct <= tankLevelLowPct) {
    return "Tank level high must be greater than low.";
  }

  return {
    sensors: {
      gas_reading: { elevated: gasElevated, critical: gasCritical },
      temp_reading: { elevated: tempElevated, critical: tempCritical },
    },
    rules: {
      vibration_anomaly_threshold: vibrationAnomaly,
      effluent_ph_min: effluentPhMin,
      effluent_ph_max: effluentPhMax,
      tank_level_high_pct: tankLevelHighPct,
      tank_level_low_pct: tankLevelLowPct,
      weather_wind_hold_ms: weatherWindHoldMs,
      cert_expiry_warning_days: certExpiryWarningDays,
    },
  };
}

interface ThresholdEditorProps {
  embedded?: boolean;
}

export function ThresholdEditor({ embedded = false }: ThresholdEditorProps) {
  const thresholdsConfig = useLiveStore((s) => s.thresholdsConfig);
  const setThresholdsConfig = useLiveStore((s) => s.setThresholdsConfig);
  const refreshThresholds = useLiveStore((s) => s.refreshThresholds);

  const [draft, setDraft] = useState<Draft>(() =>
    draftFromConfig(thresholdsConfig),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(draftFromConfig(thresholdsConfig));
  }, [thresholdsConfig]);

  function patch(field: keyof Draft, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function onSave() {
    const parsed = parseDraft(draft);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await putThresholds(parsed);
      setThresholdsConfig(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    const defaults = defaultDraft();
    const parsed = parseDraft(defaults);
    if (typeof parsed === "string") return;

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await putThresholds(parsed);
      setThresholdsConfig(next);
      setDraft(draftFromConfig(next));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={embedded ? styles.embedded : styles.panel}
      aria-label="Threshold settings"
    >
      {!embedded ? (
        <div className={styles.head}>
          <h2 className={styles.title}>Threshold settings</h2>
          <p className={styles.hint}>
            Runtime tuning for this API process. New context ingest uses updated
            bands immediately.
          </p>
        </div>
      ) : null}

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Gas &amp; temperature bands</h3>
        <p className={styles.groupHint}>
          Elevated triggers compound early warning; critical is the single-sensor
          incident line.
        </p>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Gas elevated (ppm)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.gasElevated}
              onChange={(e) => patch("gasElevated", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Gas critical (ppm)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.gasCritical}
              onChange={(e) => patch("gasCritical", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Temp elevated (°C)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.tempElevated}
              onChange={(e) => patch("tempElevated", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Temp critical (°C)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.tempCritical}
              onChange={(e) => patch("tempCritical", e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className={styles.group}>
        <h3 className={styles.groupTitle}>Equipment &amp; process rules</h3>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Vibration anomaly (mm/s)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.vibrationAnomaly}
              onChange={(e) => patch("vibrationAnomaly", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Weather wind hold (m/s)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.weatherWindHoldMs}
              onChange={(e) => patch("weatherWindHoldMs", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Effluent pH min</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.effluentPhMin}
              onChange={(e) => patch("effluentPhMin", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Effluent pH max</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.effluentPhMax}
              onChange={(e) => patch("effluentPhMax", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Tank level high (%)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.tankLevelHighPct}
              onChange={(e) => patch("tankLevelHighPct", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Tank level low (%)</span>
            <input
              className={styles.input}
              inputMode="decimal"
              value={draft.tankLevelLowPct}
              onChange={(e) => patch("tankLevelLowPct", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Cert expiry warning (days)</span>
            <input
              className={styles.input}
              inputMode="numeric"
              value={draft.certExpiryWarningDays}
              onChange={(e) => patch("certExpiryWarningDays", e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={`btn btn-primary ${styles.save}`}
          disabled={busy}
          onClick={() => void onSave()}
        >
          {busy ? "Saving…" : "Apply"}
        </button>
        <button
          type="button"
          className={`btn ${styles.reset}`}
          disabled={busy}
          onClick={() => void onReset()}
        >
          Reset defaults
        </button>
        <button
          type="button"
          className={`btn ${styles.reset}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const next = await refreshThresholds();
              setDraft(draftFromConfig(next));
              setSaved(false);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Reload
        </button>
        {saved && !error ? (
          <span className={styles.ok}>Applied</span>
        ) : null}
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  );
}
