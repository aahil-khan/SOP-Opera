"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
  x?: number;
  y?: number;
};

interface FloorOverviewProps {
  riskByAsset: Record<string, RiskLevel>;
  activityByFloor: Record<PlantFloor, number>;
  /** Floors with freshly ingested telemetry (optional visual cue). */
  freshByFloor?: Partial<Record<PlantFloor, boolean>>;
  onSelectFloor: (floor: PlantFloor) => void;
  exiting?: boolean;
}

const MAP = floorPlanMap as Record<string, FloorEntry>;
const DOT_RADIUS = 16;

const RISK_RANK: Record<RiskLevel, number> = {
  nominal: 0,
  elevated: 1,
  blocking: 2,
};

function worstRisk(levels: RiskLevel[]): RiskLevel {
  let worst: RiskLevel = "nominal";
  for (const level of levels) {
    if (RISK_RANK[level] > RISK_RANK[worst]) worst = level;
  }
  return worst;
}

function FloorThumb({
  floor,
  riskByAsset,
  activity,
  fresh,
  onSelect,
}: {
  floor: PlantFloor;
  riskByAsset: Record<string, RiskLevel>;
  activity: number;
  fresh: boolean;
  onSelect: () => void;
}) {
  const [schematic, setSchematic] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadFloorSchematic(floor, { lite: true })
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

  const assets = useMemo(
    () =>
      Object.entries(MAP)
        .filter(([, entry]) => (entry.floor ?? "ground") === floor)
        .map(([assetId, entry], index) => ({
          assetId,
          x: entry.x ?? 0,
          y: entry.y ?? 0,
          risk: (riskByAsset[assetId] ?? "nominal") as RiskLevel,
          index,
        })),
    [floor, riskByAsset],
  );

  const hotCount = assets.filter((a) => a.risk !== "nominal").length;
  const severity = worstRisk(assets.map((a) => a.risk));
  const idle = hotCount === 0 && activity === 0;

  return (
    <button
      type="button"
      className={styles.card}
      data-severity={severity}
      onClick={onSelect}
      aria-label={`Open ${FLOOR_LABELS[floor]} floor${fresh ? ", new data" : ""}`}
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
              className={`fps-root ${styles.schematicRoot}`}
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
          {schematic ? (
            <g className={styles.assetDots} pointerEvents="none">
              {assets.map((asset) => (
                <circle
                  key={asset.assetId}
                  className={styles.assetDot}
                  data-risk={asset.risk}
                  cx={asset.x}
                  cy={asset.y}
                  r={DOT_RADIUS}
                  style={
                    {
                      "--dot-index": asset.index,
                    } as CSSProperties
                  }
                />
              ))}
            </g>
          ) : null}
        </svg>
        <span className={styles.hoverHint}>Click to zoom in</span>
      </div>
      <div className={styles.meta}>
        <span className={styles.floorName}>
          {fresh ? (
            <span className={styles.freshDot} aria-label="New data" />
          ) : idle ? (
            <span className={styles.livePip} aria-hidden />
          ) : null}
          {FLOOR_LABELS[floor]}
        </span>
        <span className={styles.metaRight}>
          {idle ? (
            <span className={styles.idleHint}>Nominal · monitored</span>
          ) : (
            <>
              {hotCount > 0 ? (
                <span className={styles.riskHint}>{hotCount} elevated</span>
              ) : null}
              {activity > 0 ? (
                <span className={styles.activityBadge}>{activity}</span>
              ) : null}
            </>
          )}
        </span>
      </div>
    </button>
  );
}

export function FloorOverview({
  riskByAsset,
  activityByFloor,
  freshByFloor = {},
  onSelectFloor,
  exiting = false,
}: FloorOverviewProps) {
  return (
    <div
      className={styles.overview}
      data-exiting={exiting ? "true" : undefined}
      role="list"
      aria-label="Plant floors overview"
    >
      {FLOOR_ORDER.map((floor, index) => (
        <div
          key={floor}
          className={styles.slot}
          role="listitem"
          style={{ "--slot-index": index } as CSSProperties}
        >
          <FloorThumb
            floor={floor}
            riskByAsset={riskByAsset}
            activity={activityByFloor[floor]}
            fresh={Boolean(freshByFloor[floor])}
            onSelect={() => onSelectFloor(floor)}
          />
        </div>
      ))}
    </div>
  );
}
