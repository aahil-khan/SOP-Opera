"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RiskLevel } from "@/shared/enums";
import floorPlanMap from "@/lib/floor_plan_map.json";
import { AssetMarker } from "./AssetMarker";
import { MAP_VIEWBOX, MAP_WORLD } from "./MapViewport";
import styles from "./FloorPlan.module.css";

type HitBox = { x: number; y: number; w: number; h: number };

type FloorEntry = {
  svg_element_id: string;
  x: number;
  y: number;
  hit?: HitBox;
  zone: string;
  label: string;
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
  riskByAsset: Record<string, RiskLevel>;
  selectedAssetId: string | null;
  onSelectAsset: (id: string) => void;
}

const MAP = floorPlanMap as Record<string, FloorEntry>;
const PLAN_SRC = "/twin/new-frame.svg";

function extractSvgInner(markup: string): string {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = doc.documentElement;
  if (root.querySelector("parsererror")) {
    return "";
  }
  return Array.from(root.childNodes)
    .map((node) => new XMLSerializer().serializeToString(node))
    .join("");
}

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

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(PLAN_SRC)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${PLAN_SRC}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setSchematic(extractSvgInner(text));
      })
      .catch(() => {
        if (!cancelled) setSchematic("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        aria-label="Plant 1 coke oven complex floor plan"
      >
        <defs>
          <pattern
            id="canvas-dots"
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
          fill="url(#canvas-dots)"
        />
        {/* Inlined so SVG styles can use theme design tokens */}
        {schematic ? (
          <g
            className={`${styles.schematic} fps-root`}
            pointerEvents="none"
            dangerouslySetInnerHTML={{ __html: schematic }}
          />
        ) : null}

        {Object.entries(MAP).map(([assetId, entry]) => {
          if (!entry.hit) return null;
          const risk = riskByAsset[assetId] ?? "nominal";
          const selected = selectedAssetId === assetId;
          return (
            <rect
              key={`hit-${assetId}`}
              className={styles.hitRegion}
              data-risk={risk}
              data-selected={selected ? "true" : undefined}
              data-map-marker=""
              data-svg-id={entry.svg_element_id}
              x={entry.hit.x}
              y={entry.hit.y}
              width={entry.hit.w}
              height={entry.hit.h}
              role="button"
              aria-label={`${entry.label}, risk ${risk}`}
              onMouseDown={(e) => {
                // Prevent focus + browser scrollIntoView inside transformed map.
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
        })}

        {Object.entries(MAP).map(([assetId, entry]) => {
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

        {Object.entries(MAP).map(([assetId, entry]) => {
          const risk = riskByAsset[assetId] ?? "nominal";
          // Nominal assets use the hit-region wash only (no green dots).
          // Elevated / blocking keep markers for the pulse affordance.
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
