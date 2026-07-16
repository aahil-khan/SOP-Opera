"use client";

import type { RiskLevel } from "@/shared/enums";
import styles from "./AssetMarker.module.css";

interface AssetMarkerProps {
  id: string;
  label: string;
  x: number;
  y: number;
  risk: RiskLevel;
  selected: boolean;
  hovered?: boolean;
  onSelect: (id: string) => void;
}

export function AssetMarker({
  id,
  label,
  x,
  y,
  risk,
  selected,
  hovered = false,
  onSelect,
}: AssetMarkerProps) {
  const pulse = risk !== "nominal";

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
      aria-label={`${label}, risk ${risk}`}
    >
      <circle className={styles.hit} r={22} />
      <circle
        className={styles.pulse}
        data-active={pulse}
        data-risk={risk}
        r={12}
      />
      <circle className={styles.disk} data-risk={risk} r={10} />
    </g>
  );
}
