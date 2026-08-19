"use client";

import { useEffect, useState } from "react";
import { useLiveStore } from "@/lib/liveStore";
import { demoRequest, useDemoStatus, type DemoStatus } from "@/lib/useDemoStatus";
import type { PlantFloor } from "@/shared/enums";
import styles from "./DemoControls.module.css";

interface ScenarioInfo {
  name: string;
  label: string;
  description: string;
  step_count: number;
}

type DemoModeKind = "scripted" | "random";

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

  const { status, setStatus, refreshStatus } = useDemoStatus();

  const [mode, setMode] = useState<DemoModeKind>("scripted");
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenario, setScenario] = useState("compound_risk");
  const [descExpanded, setDescExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ambientBusy, setAmbientBusy] = useState(false);
  // Backend-backed: GET/POST /demo/seeded-mode switches which database
  // get_session() hands out for the rest of the request lifecycle (see
  // db/session.py). On means every read comes from the mock/history DB.
  const [seededMode, setSeededMode] = useState(false);
  const [seededBusy, setSeededBusy] = useState(false);

  const [maxIssues, setMaxIssues] = useState("8");
  const [paceMin, setPaceMin] = useState("4");
  const [paceMax, setPaceMax] = useState("12");
  const [seed, setSeed] = useState("");
  const [floors, setFloors] = useState<PlantFloor[]>(["ground", "first", "second"]);

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
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void demoRequest<{ enabled: boolean }>("/demo/seeded-mode")
      .then((res) => {
        if (!cancelled) setSeededMode(res.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
        // Manual arm — steps emit only when you click Next (top bar or below).
        const st = await demoRequest<DemoStatus>(
          `/demo/scenarios/${scenario}/arm`,
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

  async function onNextStep() {
    setBusy(true);
    setError(null);
    try {
      const st = await demoRequest<DemoStatus>("/demo/step", { method: "POST" });
      setStatus(st);
      void refreshOverview();
      await bootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  }

  async function onReset() {
    setBusy(true);
    setError(null);
    try {
      await demoRequest("/demo/reset", { method: "POST" });
      clearAgentSteps();
      clearTelemetry();
      // Reset also turns seeded mode off server-side (the mock corpus is
      // hidden, not deleted — see simulator/engine.py::_wipe_runtime). Reload
      // for the same reason the seeded-mode toggle does: this component's
      // local `seededMode` would otherwise still read "on", and pages that
      // fetch independently of the shared store (ReportsView, AssetHistory)
      // would keep showing rows the backend no longer returns.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  async function onToggleSeededMode() {
    setSeededBusy(true);
    setError(null);
    try {
      await demoRequest<{ enabled: boolean }>("/demo/seeded-mode/toggle", {
        method: "POST",
      });
      // The backend now points every request at a different database. The
      // shared store (bootstrap/refreshOverview) isn't the only place that
      // fetches — ReportsView, AssetHistory, and others each do their own
      // useEffect-driven fetch on mount and won't notice a global toggle.
      // A full reload is the only fix that's guaranteed to catch all of
      // them: every component's initial fetch re-runs against the new DB.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSeededBusy(false);
    }
  }

  const running = Boolean(status?.running);
  const manualArmed =
    status?.playback === "manual" && Boolean(status?.scenario);
  const sessionOpen = running || manualArmed;
  const nextLabel = status?.next_step_label ?? null;
  const canStep =
    manualArmed &&
    nextLabel != null &&
    (status?.step_index ?? 0) < (status?.total_steps ?? 0);
  const ambientOn = Boolean(status?.ambient_running);
  const showStatusBadge = Boolean(error) || sessionOpen;
  const statusText = error
    ? error
    : status?.mode === "random"
      ? `Random · ${status?.issues_spawned ?? 0} spawned · ${status?.active_issue_count ?? "?"} open`
      : status?.playback === "manual"
        ? `${status?.scenario ?? "…"} · manual ${status?.step_index ?? 0}/${status?.total_steps ?? "?"}`
        : `${status?.scenario ?? "…"} · step ${(status?.step_index ?? 0) + 1}/${status?.total_steps ?? "?"}`;

  const statusTone = error ? "error" : "running";

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
            Scripted scenarios load for manual Next-step playback. Random and
            ambient still run on their own timers.
          </p>
        </div>
        {showStatusBadge ? (
          <span
            className={styles.statusBadge}
            data-tone={statusTone}
            title={statusText}
          >
            {statusText}
          </span>
        ) : null}
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
        <h3 className={styles.sectionTitle}>Seeded mode</h3>
        <button
          type="button"
          className={styles.liveToggle}
          data-on={seededMode ? "true" : undefined}
          aria-pressed={seededMode}
          disabled={seededBusy || busy}
          onClick={() => void onToggleSeededMode()}
        >
          {seededBusy ? "Updating…" : seededMode ? "Seeded mode on" : "Seeded mode off"}
        </button>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Playback mode</h3>
        <div className={styles.segmented} role="group" aria-label="Demo mode">
          <button
            type="button"
            className={styles.segment}
            data-active={mode === "scripted" ? "true" : undefined}
            disabled={sessionOpen || busy}
            onClick={() => setMode("scripted")}
          >
            Scripted
          </button>
          <button
            type="button"
            className={styles.segment}
            data-active={mode === "random" ? "true" : undefined}
            disabled={sessionOpen || busy}
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
              disabled={sessionOpen || busy || scenarios.length === 0}
              onChange={(e) => {
                setScenario(e.target.value);
                setDescExpanded(false);
              }}
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
            <div className={styles.descWrap}>
              <p
                className={styles.fieldHint}
                data-clamped={descExpanded ? undefined : "true"}
              >
                {scenarios.find((s) => s.name === scenario)?.description}
              </p>
              <button
                type="button"
                className={styles.descToggle}
                onClick={() => setDescExpanded((v) => !v)}
                aria-expanded={descExpanded}
              >
                {descExpanded ? "Show less" : "Show more"}
              </button>
            </div>
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
                disabled={sessionOpen || busy}
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
                disabled={sessionOpen || busy}
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
                  disabled={sessionOpen || busy}
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
                  disabled={sessionOpen || busy}
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
                  disabled={sessionOpen || busy}
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
            sessionOpen ||
            busy ||
            (mode === "scripted" && scenarios.length === 0)
          }
          onClick={() => void onStart()}
        >
          {busy && !sessionOpen
            ? "Loading…"
            : mode === "scripted"
              ? "Load scenario"
              : "Start demo"}
        </button>
        {mode === "scripted" ? (
          <button
            type="button"
            className={`btn btn-primary ${styles.actionBtn}`}
            disabled={!canStep || busy}
            onClick={() => void onNextStep()}
            title={nextLabel ? `Next: ${nextLabel}` : undefined}
          >
            {canStep ? `Next · ${nextLabel}` : "Next step"}
          </button>
        ) : null}
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
