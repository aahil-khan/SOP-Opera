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
  onSelect: (id: string) => void;
}

export function AssetMarker({
  id,
  label,
  x,
  y,
  risk,
  selected,
  onSelect,
}: AssetMarkerProps) {
  const pulse = risk !== "nominal";

  return (
    <g
      className={`${styles.marker} ${selected ? styles.selected : ""}`}
      transform={`translate(${x}, ${y})`}
      onClick={() => onSelect(id)}
      role="button"
      tabIndex={0}
      aria-label={`${label}, risk ${risk}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(id);
        }
      }}
    >
      <circle className={styles.hit} r={22} />
      <circle
        className={styles.pulse}
        data-active={pulse}
        data-risk={risk}
        r={12}
      />
      <circle className={styles.disk} data-risk={risk} r={10} />
      <text className={styles.label} x={16} y={4}>
        {label}
      </text>
    </g>
  );
}
