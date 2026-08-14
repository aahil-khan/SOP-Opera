"use client";

import { useState } from "react";
import { useLiveStore } from "@/lib/liveStore";
import { demoRequest, useDemoStatus, type DemoStatus } from "@/lib/useDemoStatus";
import styles from "./DemoStepBar.module.css";

const HERO_SCENARIO = "compound_risk";
const HERO_LABEL = "Compound Risk";

/**
 * Always-visible demo pacing controls in the top nav.
 * Scripted scenarios arm without autoplay — you click Next for each beat.
 */
export function DemoStepBar() {
  const bootstrap = useLiveStore((s) => s.bootstrap);
  const refreshOverview = useLiveStore((s) => s.refreshOverview);
  const clearAgentSteps = useLiveStore((s) => s.clearAgentSteps);
  const clearTelemetry = useLiveStore((s) => s.clearTelemetry);
  const { status, setStatus, refreshStatus } = useDemoStatus();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playback = status?.playback ?? null;
  const manual =
    playback === "manual" && Boolean(status?.scenario) && status?.scenario !== "random";
  const autoRunning = Boolean(status?.running) && playback === "auto";
  const stepIndex = status?.step_index ?? 0;
  const totalSteps = status?.total_steps ?? 0;
  const nextLabel = status?.next_step_label ?? null;
  const hasNext = manual && nextLabel != null && stepIndex < totalSteps;
  const finished = manual && totalSteps > 0 && stepIndex >= totalSteps;

  async function afterMutate(st: DemoStatus) {
    setStatus(st);
    void refreshOverview();
    void bootstrap();
  }

  async function onLoad() {
    setBusy(true);
    setError(null);
    try {
      clearAgentSteps();
      clearTelemetry();
      let st: DemoStatus;
      try {
        st = await demoRequest<DemoStatus>(
          `/demo/scenarios/${HERO_SCENARIO}/arm`,
          { method: "POST" },
        );
      } catch (err) {
        // Session already open — reset once and arm again.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("409")) throw err;
        await demoRequest("/demo/reset", { method: "POST" });
        clearAgentSteps();
        clearTelemetry();
        st = await demoRequest<DemoStatus>(
          `/demo/scenarios/${HERO_SCENARIO}/arm`,
          { method: "POST" },
        );
      }
      await afterMutate(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  }

  async function onNext() {
    setBusy(true);
    setError(null);
    try {
      const st = await demoRequest<DemoStatus>("/demo/step", { method: "POST" });
      await afterMutate(st);
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
      setStatus({
        running: false,
        mode: "idle",
        playback: null,
        scenario: null,
        step_index: 0,
        total_steps: 0,
        next_step_label: null,
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

  return (
    <div className={styles.bar} role="group" aria-label="Demo scenario steps">
      {!manual && !autoRunning ? (
        <button
          type="button"
          className={styles.loadBtn}
          disabled={busy}
          onClick={() => void onLoad()}
          title="Load Compound Risk for manual step-through"
        >
          {busy ? "Loading…" : HERO_LABEL}
        </button>
      ) : null}

      {manual ? (
        <>
          <span className={styles.meta} title={status?.scenario ?? undefined}>
            <span className={styles.progress}>
              {Math.min(stepIndex, totalSteps)}/{totalSteps}
            </span>
          </span>
          {hasNext ? (
            <button
              type="button"
              className={styles.nextBtn}
              disabled={busy}
              onClick={() => void onNext()}
              title={`Next: ${nextLabel}`}
            >
              {busy ? "…" : "Next"}
            </button>
          ) : (
            <span className={styles.done}>{finished ? "Done" : "Armed"}</span>
          )}
          <button
            type="button"
            className={styles.resetBtn}
            disabled={busy}
            onClick={() => void onReset()}
          >
            Reset
          </button>
        </>
      ) : null}

      {autoRunning ? (
        <span className={styles.autoHint} title="Auto-play in progress (e.g. Grand Tour)">
          Auto · {status?.scenario ?? "…"} {stepIndex}/{totalSteps}
        </span>
      ) : null}

      {error ? (
        <span className={styles.error} title={error}>
          !
        </span>
      ) : null}
    </div>
  );
}
