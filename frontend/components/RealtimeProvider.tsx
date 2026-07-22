"use client";

import { useEffect } from "react";
import { useLiveStore } from "@/lib/liveStore";
import { useRealtimeEvents } from "@/hooks/useRealtimeEvents";
import {
  FLOOR_ORDER,
  loadFloorSchematic,
} from "@/components/twin/floorPlanShared";

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

  // Warm floor SVG cache so overview ↔ detail switches don't hitch on fetch/parse.
  useEffect(() => {
    if (!bootstrapped) return;
    for (const floor of FLOOR_ORDER) {
      void loadFloorSchematic(floor).catch(() => {});
      void loadFloorSchematic(floor, { lite: true }).catch(() => {});
    }
  }, [bootstrapped]);

  useRealtimeEvents(true);

  return <>{children}</>;
}
