"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { useLiveStore } from "@/lib/liveStore";
import type { PlantFloor } from "@/shared/enums";
import styles from "./DemoControls.module.css";

interface ScenarioInfo {
  name: string;
  label: string;
  description: string;
  step_count: number;
}

interface DemoStatus {
  running: boolean;
  mode?: "idle" | "scripted" | "random";
  scenario: string | null;
  step_index: number;
  total_steps: number;
  started_at: string | null;
  issues_spawned?: number;
  active_issue_count?: number;
  ambient_running?: boolean;
  demo_locked_assets?: string[];
}

type DemoModeKind = "scripted" | "random";

async function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail ?? body);
    } catch {
      /* ignore */
    }
    throw new Error(
      `${init?.method ?? "GET"} ${path} failed (${res.status}): ${detail}`,
    );
  }
  return res.json() as Promise<T>;
}

const FLOOR_OPTIONS: { id: PlantFloor; label: string }[] = [
  { id: "ground", label: "G" },
  { id: "first", label: "1" },
  { id: "second", label: "2" },
];

export function DemoControls() {
  const bootstrap = useLiveStore((s) => s.bootstrap);
  const refreshOverview = useLiveStore((s) => s.refreshOverview);
  const clearAgentSteps = useLiveStore((s) => s.clearAgentSteps);
  const clearTelemetry = useLiveStore((s) => s.clearTelemetry);

  const [mode, setMode] = useState<DemoModeKind>("scripted");
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenario, setScenario] = useState("vsp_coke_oven");
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ambientBusy, setAmbientBusy] = useState(false);

  const [maxIssues, setMaxIssues] = useState("8");
  const [paceMin, setPaceMin] = useState("4");
  const [paceMax, setPaceMax] = useState("12");
  const [seed, setSeed] = useState("");
  const [floors, setFloors] = useState<PlantFloor[]>(["ground", "first", "second"]);

  const refreshStatus = useCallback(async () => {
    try {
      const st = await demoRequest<DemoStatus>("/demo/status");
      setStatus(st);
    } catch {
      /* backend may be down — keep last known */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void demoRequest<ScenarioInfo[]>("/demo/scenarios")
      .then((list) => {
        if (cancelled || !list.length) return;
        setScenarios(list);
        setScenario((prev) =>
          list.some((s) => s.name === prev) ? prev : list[0].name,
        );
      })
      .catch(() => {});
    void refreshStatus();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  useEffect(() => {
    // Poll ambient even when demo is idle so Live indicator stays accurate
    const id = setInterval(() => {
      void refreshStatus();
    }, status?.running ? 1500 : 8000);
    return () => clearInterval(id);
  }, [status?.running, refreshStatus]);

  function toggleFloor(f: PlantFloor) {
    setFloors((prev) => {
      if (prev.includes(f)) {
        const next = prev.filter((x) => x !== f);
        return next.length ? next : prev;
      }
      return [...prev, f];
    });
  }

  async function onStart() {
    setBusy(true);
    setError(null);
    try {
      clearAgentSteps();
      if (mode === "scripted") {
        const st = await demoRequest<DemoStatus>(
          `/demo/scenarios/${scenario}/start`,
          { method: "POST" },
        );
        setStatus(st);
      } else {
        const body: Record<string, unknown> = {
          max_concurrent_issues: Number(maxIssues) || 8,
          spawn_interval_min_seconds: Number(paceMin) || 4,
          spawn_interval_max_seconds: Number(paceMax) || 12,
          floors,
        };
        if (seed.trim() !== "") {
          const n = Number(seed);
          if (!Number.isNaN(n)) body.seed = n;
        }
        const st = await demoRequest<DemoStatus>("/demo/random/start", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setStatus(st);
      }
      void refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onReset() {
    setBusy(true);
    setError(null);
    try {
      await demoRequest("/demo/reset", { method: "POST" });
      clearAgentSteps();
      clearTelemetry();
      setStatus({
        running: false,
        mode: "idle",
        scenario: null,
        step_index: 0,
        total_steps: 0,
        started_at: null,
        issues_spawned: 0,
        active_issue_count: 0,
      });
      await bootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  }

  async function onToggleAmbient() {
    setAmbientBusy(true);
    setError(null);
    try {
      const path = status?.ambient_running
        ? "/demo/ambient/stop"
        : "/demo/ambient/start";
      const st = await demoRequest<DemoStatus>(path, { method: "POST" });
      // Ambient endpoints return ambient status shape; refresh full demo status
      void refreshStatus();
      if (!status?.ambient_running && "running" in st) {
        /* started */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAmbientBusy(false);
    }
  }

  const running = Boolean(status?.running);
  const ambientOn = Boolean(status?.ambient_running);
  const statusText = error
    ? error
    : running
      ? status?.mode === "random"
        ? `random #${status?.issues_spawned ?? 0} · open ${status?.active_issue_count ?? "?"}`
        : `${status?.scenario ?? "…"} ${(status?.step_index ?? 0) + 1}/${status?.total_steps ?? "?"}`
      : ambientOn
        ? "Live plant"
        : "Idle";

  return (
    <div className={styles.controls} role="group" aria-label="Demo Mode">
      <span className={styles.label}>Demo</span>
      <button
        type="button"
        className={styles.ambientBtn}
        data-on={ambientOn ? "true" : undefined}
        disabled={ambientBusy || busy}
        onClick={() => void onToggleAmbient()}
        title={
          ambientOn
            ? "Ambient live feed on (rare coincidence failures possible)"
            : "Start ambient live plant feed"
        }
      >
        {ambientBusy ? "…" : ambientOn ? "Live on" : "Live off"}
      </button>
      <select
        className={styles.select}
        aria-label="Demo mode"
        value={mode}
        disabled={running || busy}
        onChange={(e) => setMode(e.target.value as DemoModeKind)}
      >
        <option value="scripted">Scripted</option>
        <option value="random">Random</option>
      </select>

      {mode === "scripted" ? (
        <select
          className={styles.select}
          aria-label="Scenario"
          value={scenario}
          disabled={running || busy || scenarios.length === 0}
          onChange={(e) => setScenario(e.target.value)}
          title={
            scenarios.find((s) => s.name === scenario)?.description ?? "Scenario"
          }
        >
          {scenarios.length === 0 ? (
            <option value={scenario}>…</option>
          ) : (
            scenarios.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label}
              </option>
            ))
          )}
        </select>
      ) : (
        <>
          <label className={styles.field} title="Max concurrent open reviews">
            <span>n</span>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={40}
              value={maxIssues}
              disabled={running || busy}
              onChange={(e) => setMaxIssues(e.target.value)}
              aria-label="Max concurrent issues"
            />
          </label>
          <label className={styles.field} title="Spawn interval seconds (min–max)">
            <span>pace</span>
            <input
              className={styles.inputNarrow}
              type="number"
              min={0.5}
              step={0.5}
              value={paceMin}
              disabled={running || busy}
              onChange={(e) => setPaceMin(e.target.value)}
              aria-label="Min spawn interval seconds"
            />
            <span>–</span>
            <input
              className={styles.inputNarrow}
              type="number"
              min={0.5}
              step={0.5}
              value={paceMax}
              disabled={running || busy}
              onChange={(e) => setPaceMax(e.target.value)}
              aria-label="Max spawn interval seconds"
            />
          </label>
          <label className={styles.field} title="Optional seed for reproducibility">
            <span>seed</span>
            <input
              className={styles.input}
              type="text"
              inputMode="numeric"
              placeholder="rand"
              value={seed}
              disabled={running || busy}
              onChange={(e) => setSeed(e.target.value)}
              aria-label="Random seed"
            />
          </label>
          <div className={styles.floorPool} role="group" aria-label="Floor pool">
            {FLOOR_OPTIONS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={styles.floorChip}
                data-on={floors.includes(f.id) ? "true" : undefined}
                disabled={running || busy}
                onClick={() => toggleFloor(f.id)}
                title={`Include ${f.id} floor`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        className={`btn btn-primary ${styles.btn}`}
        disabled={
          running ||
          busy ||
          (mode === "scripted" && scenarios.length === 0)
        }
        onClick={() => void onStart()}
      >
        {busy && !running ? "…" : "Start"}
      </button>
      <button
        type="button"
        className={`btn ${styles.btn}`}
        disabled={busy}
        onClick={() => void onReset()}
      >
        Reset
      </button>
      <span
        className={styles.status}
        data-error={error ? "true" : undefined}
        title={statusText}
      >
        {statusText}
      </span>
    </div>
  );
}
