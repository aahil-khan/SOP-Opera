"use client";

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";
import { useLiveStore } from "@/lib/liveStore";
import styles from "./DemoControls.module.css";

interface ScenarioInfo {
  name: string;
  label: string;
  description: string;
  step_count: number;
}

interface DemoStatus {
  running: boolean;
  scenario: string | null;
  step_index: number;
  total_steps: number;
  started_at: string | null;
}

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

export function DemoControls() {
  const bootstrap = useLiveStore((s) => s.bootstrap);
  const refreshOverview = useLiveStore((s) => s.refreshOverview);

  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenario, setScenario] = useState("compound_risk");
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!status?.running) return;
    const id = setInterval(() => {
      void refreshStatus();
      void refreshOverview();
    }, 800);
    return () => clearInterval(id);
  }, [status?.running, refreshStatus, refreshOverview]);

  async function onStart() {
    setBusy(true);
    setError(null);
    try {
      const st = await demoRequest<DemoStatus>(
        `/demo/scenarios/${scenario}/start`,
        { method: "POST" },
      );
      setStatus(st);
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
      setStatus({
        running: false,
        scenario: null,
        step_index: 0,
        total_steps: 0,
        started_at: null,
      });
      await bootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  }

  const running = Boolean(status?.running);
  const statusText = error
    ? error
    : running
      ? `${status?.scenario ?? "…"} ${(status?.step_index ?? 0) + 1}/${status?.total_steps ?? "?"}`
      : "Idle";

  return (
    <div className={styles.controls} role="group" aria-label="Demo Mode">
      <span className={styles.label}>Demo</span>
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
      <button
        type="button"
        className={`btn btn-primary ${styles.btn}`}
        disabled={running || busy || scenarios.length === 0}
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
