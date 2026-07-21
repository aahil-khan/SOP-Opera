"use client";

import { memo, forwardRef } from "react";
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
  /** Same green "new" cue as the open-work list. */
  fresh?: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}

export const AssetMarker = memo(
  forwardRef<SVGGElement, AssetMarkerProps>(function AssetMarker(
    {
      id,
      label,
      x,
      y,
      risk,
      sensorCritical = false,
      resolved = false,
      fresh = false,
      selected,
      onSelect,
    },
    ref,
  ) {
    const pulse = !resolved && (risk !== "nominal" || sensorCritical);

    return (
      <g
        ref={ref}
        className={`${styles.marker} ${selected ? styles.selected : ""}`}
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
        aria-label={`${label}, ${resolved ? "work halted" : `risk ${risk}`}${sensorCritical ? ", sensor critical" : ""}${fresh ? ", new data" : ""}`}
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
        {fresh ? (
          <>
            <circle className={styles.freshRing} r={14} aria-hidden />
            <circle className={styles.freshDot} cx={8} cy={-8} r={3} aria-hidden />
          </>
        ) : null}
      </g>
    );
  }),
);
