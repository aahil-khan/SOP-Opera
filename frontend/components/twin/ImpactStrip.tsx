"use client";

import { useMemo } from "react";
import { useLiveAssetViews, useLiveStore } from "@/lib/liveStore";
import {
  isBlockedWork,
  isElevatedOrBlocking,
} from "@/lib/openWork";
import styles from "./ImpactStrip.module.css";

interface ImpactStripProps {
  shiftForDrawer?: boolean;
}

function countHazardousWorkers(
  status: { category: string; label: string }[],
): number {
  return status.filter(
    (s) =>
      s.category === "worker_location" &&
      s.label.toLowerCase().includes("hazardous"),
  ).length;
}

export function ImpactStrip({ shiftForDrawer = false }: ImpactStripProps) {
  const views = useLiveAssetViews();
  const telemetryStatus = useLiveStore((s) => s.telemetryStatus);

  const kpis = useMemo(() => {
    const openReviews = views.filter(
      (v) => v.review != null && v.review.state !== "closed",
    ).length;

    const zones = new Set<string>();
    for (const v of views) {
      if (!isElevatedOrBlocking(v)) continue;
      if (v.asset.zone) zones.add(v.asset.zone);
    }

    const peopleAtRisk = countHazardousWorkers(telemetryStatus);
    const blockedWork = views.filter(isBlockedWork).length;

    return [
      {
        key: "open",
        label: "Open reviews",
        value: openReviews,
        warn: openReviews > 0,
      },
      {
        key: "zones",
        label: "Zones locked",
        value: zones.size,
        warn: zones.size > 0,
      },
      {
        key: "people",
        label: "People at risk",
        value: peopleAtRisk,
        warn: peopleAtRisk > 0,
      },
      {
        key: "blocked",
        label: "Blocked work",
        value: blockedWork,
        warn: blockedWork > 0,
      },
    ];
  }, [views, telemetryStatus]);

  return (
    <div
      className={styles.strip}
      data-shift={shiftForDrawer ? "true" : undefined}
      role="region"
      aria-label="Operations impact"
    >
      <div className={styles.header}>
        <span className={styles.mark}>Impact</span>
        <span className={styles.title}>Ops KPIs</span>
      </div>
      <div className={styles.kpis}>
        {kpis.map((k) => (
          <div
            key={k.key}
            className={styles.kpi}
            data-warn={k.warn ? "true" : undefined}
          >
            <span className={styles.value}>{k.value}</span>
            <span className={styles.label}>{k.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
