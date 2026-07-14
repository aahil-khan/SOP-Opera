"use client";

import type { RiskLevel } from "@/shared/enums";
import floorPlanMap from "@/lib/floor_plan_map.json";
import { AssetMarker } from "./AssetMarker";
import styles from "./FloorPlan.module.css";

type FloorEntry = {
  svg_element_id: string;
  x: number;
  y: number;
  zone: string;
  label: string;
};

interface FloorPlanProps {
  riskByAsset: Record<string, RiskLevel>;
  selectedAssetId: string | null;
  onSelectAsset: (id: string) => void;
}

const MAP = floorPlanMap as Record<string, FloorEntry>;

export function FloorPlan({
  riskByAsset,
  selectedAssetId,
  onSelectAsset,
}: FloorPlanProps) {
  return (
    <div className={styles.plan}>
      <svg
        className={styles.svg}
        viewBox="0 0 640 520"
        role="img"
        aria-label="Plant floor plan schematic"
      >
        <text className={styles.title} x={24} y={32}>
          Plant 1 · Digital Twin
        </text>
        <text className={styles.subtitle} x={24} y={52}>
          Schematic · click an asset for live Context and reasoning trace
        </text>

        {/* Coke Oven Battery */}
        <rect
          className={styles.zone}
          x={40}
          y={80}
          width={280}
          height={180}
          rx={8}
        />
        <text className={styles.zoneLabel} x={56} y={104}>
          Coke Oven Battery
        </text>

        {/* Hazardous Walkway */}
        <rect
          className={styles.zone}
          x={340}
          y={80}
          width={260}
          height={180}
          rx={8}
        />
        <text className={styles.zoneLabel} x={356} y={104}>
          Hazardous Walkway
        </text>
        <rect
          className={styles.walkway}
          x={360}
          y={140}
          width={220}
          height={24}
          rx={4}
        />
        <rect
          className={styles.walkway}
          x={360}
          y={180}
          width={220}
          height={24}
          rx={4}
        />

        {/* Compressor Yard */}
        <rect
          className={styles.zone}
          x={40}
          y={290}
          width={280}
          height={190}
          rx={8}
        />
        <text className={styles.zoneLabel} x={56} y={314}>
          Compressor Yard
        </text>

        {/* Tank Farm */}
        <rect
          className={styles.zone}
          x={340}
          y={290}
          width={260}
          height={190}
          rx={8}
        />
        <text className={styles.zoneLabel} x={356} y={314}>
          Tank Farm
        </text>

        {Object.entries(MAP).map(([assetId, entry]) => (
          <AssetMarker
            key={assetId}
            id={assetId}
            label={entry.label}
            x={entry.x}
            y={entry.y}
            risk={riskByAsset[assetId] ?? "nominal"}
            selected={selectedAssetId === assetId}
            onSelect={onSelectAsset}
          />
        ))}
      </svg>
    </div>
  );
}
