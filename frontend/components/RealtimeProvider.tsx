"use client";

import { useEffect } from "react";
import { useLiveStore } from "@/lib/liveStore";
import { useRealtimeEvents } from "@/hooks/useRealtimeEvents";

/** Bootstraps live state + WebSocket once for the whole app shell. */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = useLiveStore((s) => s.bootstrap);
  const bootstrapped = useLiveStore((s) => s.bootstrapped);
  const refreshThresholds = useLiveStore((s) => s.refreshThresholds);

  useEffect(() => {
    if (!bootstrapped) {
      void bootstrap();
    }
  }, [bootstrap, bootstrapped]);

  useEffect(() => {
    void refreshThresholds();
  }, [refreshThresholds]);

  useRealtimeEvents(true);

  return <>{children}</>;
}
