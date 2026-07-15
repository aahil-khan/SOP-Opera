"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RiskLevel } from "@/shared/enums";
import type { PlantFloor } from "@/shared/enums";
import floorPlanMap from "@/lib/floor_plan_map.json";
import { AssetMarker } from "./AssetMarker";
import { MAP_VIEWBOX, MAP_WORLD } from "./MapViewport";
import { loadFloorSchematic } from "./floorPlanShared";
import styles from "./FloorPlan.module.css";

type HitBox = { x: number; y: number; w: number; h: number; angle?: number };

type FloorEntry = {
  svg_element_id: string;
  x: number;
  y: number;
  hit?: HitBox;
  zone: string;
  label: string;
  floor: PlantFloor;
};

type HoverTip = {
  assetId: string;
  label: string;
  risk: RiskLevel;
  x: number;
  y: number;
  place: "above" | "below";
};

interface FloorPlanProps {
  floor: PlantFloor;
  riskByAsset: Record<string, RiskLevel>;
  selectedAssetId: string | null;
  onSelectAsset: (id: string) => void;
}

const MAP = floorPlanMap as Record<string, FloorEntry>;

function tipFromTarget(
  assetId: string,
  entry: FloorEntry,
  risk: RiskLevel,
  target: SVGGraphicsElement,
): HoverTip {
  const rect = target.getBoundingClientRect();
  const place = rect.top < 56 ? "below" : "above";
  return {
    assetId,
    label: entry.label,
    risk,
    x: rect.left + rect.width / 2,
    y: place === "above" ? rect.top : rect.bottom,
    place,
  };
}

export function FloorPlan({
  floor,
  riskByAsset,
  selectedAssetId,
  onSelectAsset,
}: FloorPlanProps) {
  const [schematic, setSchematic] = useState<string>("");
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);
  const [rippleAssetId, setRippleAssetId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const rippleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const floorEntries = Object.entries(MAP).filter(
    ([, entry]) => (entry.floor ?? "ground") === floor,
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSchematic("");
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

  useEffect(() => {
    return () => {
      if (rippleTimer.current) clearTimeout(rippleTimer.current);
    };
  }, []);

  const triggerRipple = (assetId: string) => {
    setRippleAssetId(assetId);
    if (rippleTimer.current) clearTimeout(rippleTimer.current);
    rippleTimer.current = setTimeout(() => setRippleAssetId(null), 500);
  };

  const showTip = (
    assetId: string,
    entry: FloorEntry,
    risk: RiskLevel,
    target: EventTarget | null,
  ) => {
    if (!(target instanceof SVGGraphicsElement)) return;
    setHoveredAssetId(assetId);
    setHoverTip(tipFromTarget(assetId, entry, risk, target));
  };

  const clearTip = (assetId: string) => {
    setHoveredAssetId((cur) => (cur === assetId ? null : cur));
    setHoverTip((cur) => (cur?.assetId === assetId ? null : cur));
  };

  return (
    <div className={styles.plan}>
      <svg
        className={styles.svg}
        width={MAP_WORLD.width}
        height={MAP_WORLD.height}
        viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
        role="img"
        aria-label={`Plant 1 ${floor} floor plan`}
      >
        <defs>
          <pattern
            id={`canvas-dots-${floor}`}
            width="18"
            height="18"
            patternUnits="userSpaceOnUse"
          >
            <rect
              width="18"
              height="18"
              className={styles.canvasBg}
            />
            <circle
              className={styles.canvasDot}
              cx="1.5"
              cy="1.5"
              r="1.1"
            />
          </pattern>
        </defs>

        <rect
          x={0}
          y={0}
          width={MAP_VIEWBOX.width}
          height={MAP_VIEWBOX.height}
          fill={`url(#canvas-dots-${floor})`}
        />
        {schematic ? (
          <g
            className={`${styles.schematic} fps-root`}
            pointerEvents="none"
            dangerouslySetInnerHTML={{ __html: schematic }}
          />
        ) : null}

        {floorEntries.map(([assetId, entry]) => {
          if (!entry.hit) return null;
          const risk = riskByAsset[assetId] ?? "nominal";
          const selected = selectedAssetId === assetId;
          const { x, y, w, h, angle } = entry.hit;
          const cx = x + w / 2;
          const cy = y + h / 2;
          const hitRect = (
            <rect
              className={styles.hitRegion}
              data-risk={risk}
              data-selected={selected ? "true" : undefined}
              data-map-marker=""
              data-svg-id={entry.svg_element_id}
              x={x}
              y={y}
              width={w}
              height={h}
              role="button"
              aria-label={`${entry.label}, risk ${risk}`}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onMouseEnter={(e) => showTip(assetId, entry, risk, e.currentTarget)}
              onMouseMove={(e) => showTip(assetId, entry, risk, e.currentTarget)}
              onMouseLeave={() => clearTip(assetId)}
              onClick={() => {
                triggerRipple(assetId);
                onSelectAsset(assetId);
              }}
            />
          );
          return (
            <g key={`hit-${assetId}`} transform={angle ? `rotate(${angle} ${cx} ${cy})` : undefined}>
              {hitRect}
            </g>
          );
        })}

        {floorEntries.map(([assetId, entry]) => {
          const risk = riskByAsset[assetId] ?? "nominal";
          if (rippleAssetId === assetId) {
            return (
              <circle
                key={`ripple-${assetId}`}
                className={styles.clickRipple}
                data-risk={risk}
                cx={entry.x}
                cy={entry.y}
                r={10}
                pointerEvents="none"
              />
            );
          }
          return null;
        })}

        {floorEntries.map(([assetId, entry]) => {
          const risk = riskByAsset[assetId] ?? "nominal";
          if (risk === "nominal" && entry.hit) return null;
          return (
            <AssetMarker
              key={assetId}
              id={assetId}
              label={entry.label}
              x={entry.x}
              y={entry.y}
              risk={risk}
              selected={selectedAssetId === assetId}
              hovered={hoveredAssetId === assetId}
              onSelect={onSelectAsset}
            />
          );
        })}
      </svg>

      {mounted &&
        hoverTip &&
        createPortal(
          <div
            className={styles.tooltip}
            data-risk={hoverTip.risk}
            data-place={hoverTip.place}
            style={{
              left: Math.min(
                Math.max(hoverTip.x, 12),
                typeof window !== "undefined" ? window.innerWidth - 12 : hoverTip.x,
              ),
              top: hoverTip.y,
            }}
            role="tooltip"
          >
            <span className={styles.tooltipDot} aria-hidden />
            <span className={styles.tooltipName}>{hoverTip.label}</span>
            <span className={styles.tooltipRisk}>{hoverTip.risk}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}
