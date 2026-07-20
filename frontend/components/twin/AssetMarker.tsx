"use client";

import { memo } from "react";
import type { RiskLevel } from "@/shared/enums";
import styles from "./AssetMarker.module.css";

interface AssetMarkerProps {
  id: string;
  label: string;
  x: number;
  y: number;
  risk: RiskLevel;
  sensorCritical?: boolean;
  resolved?: boolean;
  selected: boolean;
  hovered?: boolean;
  onSelect: (id: string) => void;
}

export const AssetMarker = memo(function AssetMarker({
  id,
  label,
  x,
  y,
  risk,
  sensorCritical = false,
  resolved = false,
  selected,
  hovered = false,
  onSelect,
}: AssetMarkerProps) {
  const pulse = !resolved && (risk !== "nominal" || sensorCritical);

  return (
    <g
      className={`${styles.marker} ${selected ? styles.selected : ""} ${
        hovered ? styles.hovered : ""
      }`}
      transform={`translate(${x}, ${y})`}
      onMouseDown={(e) => {
        // Avoid focus scrollIntoView fighting the pan/zoom transform.
        e.preventDefault();
      }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(id);
              }}
      role="button"
      tabIndex={-1}
      data-map-marker=""
      aria-label={`${label}, ${resolved ? "work halted" : `risk ${risk}`}${sensorCritical ? ", sensor critical" : ""}`}
    >
      <circle className={styles.hit} r={22} />
      <circle
        className={styles.pulse}
        data-active={pulse}
        data-risk={risk}
        data-sensor-critical={sensorCritical ? "true" : undefined}
        data-resolved={resolved ? "true" : undefined}
        r={12}
      />
      <circle
        className={styles.disk}
        data-risk={risk}
        data-sensor-critical={sensorCritical ? "true" : undefined}
        data-resolved={resolved ? "true" : undefined}
        r={10}
      />
    </g>
  );
});
