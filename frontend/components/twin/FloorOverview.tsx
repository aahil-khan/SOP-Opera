"use client";

import { useEffect, useState } from "react";
import type { PlantFloor, RiskLevel } from "@/shared/enums";
import floorPlanMap from "@/lib/floor_plan_map.json";
import { MAP_VIEWBOX } from "./MapViewport";
import {
  FLOOR_LABELS,
  FLOOR_ORDER,
  loadFloorSchematic,
} from "./floorPlanShared";
import floorPlanStyles from "./FloorPlan.module.css";
import styles from "./FloorOverview.module.css";

type FloorEntry = {
  floor?: PlantFloor;
};

interface FloorOverviewProps {
  riskByAsset: Record<string, RiskLevel>;
  activityByFloor: Record<PlantFloor, number>;
  onSelectFloor: (floor: PlantFloor) => void;
}

const MAP = floorPlanMap as Record<string, FloorEntry>;

function FloorThumb({
  floor,
  riskByAsset,
  activity,
  onSelect,
}: {
  floor: PlantFloor;
  riskByAsset: Record<string, RiskLevel>;
  activity: number;
  onSelect: () => void;
}) {
  const [schematic, setSchematic] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadFloorSchematic(floor)
      .then((inner) => {
        if (!cancelled) setSchematic(inner);
      })
      .catch(() => {
        if (!cancelled) setSchematic("");
      });
    return () => {
      cancelled = true;
    };
  }, [floor]);

  const hotCount = Object.entries(MAP).filter(([assetId, entry]) => {
    if ((entry.floor ?? "ground") !== floor) return false;
    const risk = riskByAsset[assetId] ?? "nominal";
    return risk !== "nominal";
  }).length;

  return (
    <button
      type="button"
      className={styles.card}
      onClick={onSelect}
      aria-label={`Open ${FLOOR_LABELS[floor]} floor`}
    >
      <div className={styles.preview}>
        <svg
          className={`${styles.previewSvg} ${floorPlanStyles.schematic}`}
          viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
          role="img"
          aria-hidden
        >
          <rect
            x={0}
            y={0}
            width={MAP_VIEWBOX.width}
            height={MAP_VIEWBOX.height}
            className={styles.previewCanvas}
          />
          {schematic ? (
            <g
              className="fps-root"
              pointerEvents="none"
              dangerouslySetInnerHTML={{ __html: schematic }}
            />
          ) : (
            <text
              x={MAP_VIEWBOX.width / 2}
              y={MAP_VIEWBOX.height / 2}
              textAnchor="middle"
              className={styles.loadingText}
            >
              Loading…
            </text>
          )}
        </svg>
        <span className={styles.hoverHint}>Click to zoom in</span>
      </div>
      <div className={styles.meta}>
        <span className={styles.floorName}>{FLOOR_LABELS[floor]}</span>
        <span className={styles.metaRight}>
          {hotCount > 0 ? (
            <span className={styles.riskHint}>{hotCount} elevated</span>
          ) : null}
          {activity > 0 ? (
            <span className={styles.activityBadge}>{activity}</span>
          ) : null}
        </span>
      </div>
    </button>
  );
}

export function FloorOverview({
  riskByAsset,
  activityByFloor,
  onSelectFloor,
}: FloorOverviewProps) {
  return (
    <div className={styles.overview} role="list" aria-label="Plant floors overview">
      {FLOOR_ORDER.map((floor) => (
        <div key={floor} className={styles.slot} role="listitem">
          <FloorThumb
            floor={floor}
            riskByAsset={riskByAsset}
            activity={activityByFloor[floor]}
            onSelect={() => onSelectFloor(floor)}
          />
        </div>
      ))}
    </div>
  );
}
