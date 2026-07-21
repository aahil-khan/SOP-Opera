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

interface DemoControlsProps {
  variant?: "panel";
}

export function DemoControls({ variant = "panel" }: DemoControlsProps) {
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
    const tick = () => {
      if (document.hidden) return;
      void refreshStatus();
    };
    const id = setInterval(tick, status?.running ? 1500 : 8000);
    const onVisibility = () => {
      if (!document.hidden) void refreshStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
      clearTelemetry();
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
      await bootstrap();
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
      await demoRequest<DemoStatus>(path, { method: "POST" });
      void refreshStatus();
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
        ? `Random · ${status?.issues_spawned ?? 0} spawned · ${status?.active_issue_count ?? "?"} open`
        : `${status?.scenario ?? "…"} · step ${(status?.step_index ?? 0) + 1}/${status?.total_steps ?? "?"}`
      : ambientOn
        ? "Live plant feed active"
        : "Idle";

  const statusTone = error
    ? "error"
    : running
      ? "running"
      : ambientOn
        ? "live"
        : "idle";

  return (
    <div
      className={styles.panel}
      role="group"
      aria-label="Demo controls"
      data-variant={variant}
    >
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h2 className={styles.title}>Demo</h2>
          <p className={styles.subtitle}>
            Scripted scenarios, random issues, and ambient plant feed.
          </p>
        </div>
        <span
          className={styles.statusBadge}
          data-tone={statusTone}
          title={statusText}
        >
          {statusText}
        </span>
      </header>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Ambient feed</h3>
        <button
          type="button"
          className={styles.liveToggle}
          data-on={ambientOn ? "true" : undefined}
          disabled={ambientBusy || busy}
          onClick={() => void onToggleAmbient()}
        >
          {ambientBusy ? "Updating…" : ambientOn ? "Live feed on" : "Live feed off"}
        </button>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Playback mode</h3>
        <div className={styles.segmented} role="group" aria-label="Demo mode">
          <button
            type="button"
            className={styles.segment}
            data-active={mode === "scripted" ? "true" : undefined}
            disabled={running || busy}
            onClick={() => setMode("scripted")}
          >
            Scripted
          </button>
          <button
            type="button"
            className={styles.segment}
            data-active={mode === "random" ? "true" : undefined}
            disabled={running || busy}
            onClick={() => setMode("random")}
          >
            Random
          </button>
        </div>
      </section>

      {mode === "scripted" ? (
        <section className={styles.section}>
          <label className={styles.fieldBlock}>
            <span className={styles.fieldLabel}>Scenario</span>
            <select
              className={styles.select}
              aria-label="Scenario"
              value={scenario}
              disabled={running || busy || scenarios.length === 0}
              onChange={(e) => setScenario(e.target.value)}
            >
              {scenarios.length === 0 ? (
                <option value={scenario}>Loading…</option>
              ) : (
                scenarios.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.label}
                  </option>
                ))
              )}
            </select>
          </label>
          {scenarios.find((s) => s.name === scenario)?.description ? (
            <p className={styles.fieldHint}>
              {scenarios.find((s) => s.name === scenario)?.description}
            </p>
          ) : null}
        </section>
      ) : (
        <section className={styles.section}>
          <div className={styles.randomGrid}>
            <label className={styles.fieldBlock}>
              <span className={styles.fieldLabel}>Max concurrent issues</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={40}
                value={maxIssues}
                disabled={running || busy}
                onChange={(e) => setMaxIssues(e.target.value)}
              />
            </label>
            <label className={styles.fieldBlock}>
              <span className={styles.fieldLabel}>Seed (optional)</span>
              <input
                className={styles.input}
                type="text"
                inputMode="numeric"
                placeholder="Random"
                value={seed}
                disabled={running || busy}
                onChange={(e) => setSeed(e.target.value)}
              />
            </label>
            <label className={styles.fieldBlockWide}>
              <span className={styles.fieldLabel}>Spawn interval (seconds)</span>
              <div className={styles.rangeRow}>
                <input
                  className={styles.input}
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={paceMin}
                  disabled={running || busy}
                  onChange={(e) => setPaceMin(e.target.value)}
                  aria-label="Min spawn interval"
                />
                <span className={styles.rangeSep}>to</span>
                <input
                  className={styles.input}
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={paceMax}
                  disabled={running || busy}
                  onChange={(e) => setPaceMax(e.target.value)}
                  aria-label="Max spawn interval"
                />
              </div>
            </label>
          </div>
          <div className={styles.floorBlock}>
            <span className={styles.fieldLabel}>Floor pool</span>
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
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <button
          type="button"
          className={`btn btn-primary ${styles.actionBtn}`}
          disabled={
            running ||
            busy ||
            (mode === "scripted" && scenarios.length === 0)
          }
          onClick={() => void onStart()}
        >
          {busy && !running ? "Starting…" : "Start demo"}
        </button>
        <button
          type="button"
          className={`btn ${styles.actionBtn}`}
          disabled={busy}
          onClick={() => void onReset()}
        >
          Reset
        </button>
      </footer>
    </div>
  );
}
