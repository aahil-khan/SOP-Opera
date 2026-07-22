"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { API_BASE } from "@/lib/api";

export interface DemoStatus {
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

export async function demoRequest<T>(path: string, init?: RequestInit): Promise<T> {
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

type DemoStatusStore = {
  status: DemoStatus | null;
  setStatus: (status: DemoStatus | null) => void;
};

const useDemoStatusStore = create<DemoStatusStore>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollSubscribers = 0;

async function refreshDemoStatus() {
  try {
    const st = await demoRequest<DemoStatus>("/demo/status");
    useDemoStatusStore.getState().setStatus(st);
  } catch {
    /* backend may be down — keep last known */
  }
}

function pollIntervalMs() {
  return useDemoStatusStore.getState().status?.running ? 1500 : 8000;
}

function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    void refreshDemoStatus();
  }, pollIntervalMs());
}

function ensurePolling() {
  if (pollSubscribers === 0) {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    return;
  }
  if (!pollTimer) {
    restartPolling();
  }
}

export function useDemoStatus() {
  const status = useDemoStatusStore((s) => s.status);
  const setStatus = useDemoStatusStore((s) => s.setStatus);

  useEffect(() => {
    pollSubscribers += 1;
    void refreshDemoStatus();
    ensurePolling();

    const onVisibility = () => {
      if (!document.hidden) void refreshDemoStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      pollSubscribers -= 1;
      document.removeEventListener("visibilitychange", onVisibility);
      ensurePolling();
    };
  }, []);

  useEffect(() => {
    if (pollSubscribers === 0 || !pollTimer) return;
    restartPolling();
  }, [status?.running]);

  return {
    status,
    setStatus,
    refreshStatus: refreshDemoStatus,
  };
}
