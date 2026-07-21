"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { PlantFloor, RiskLevel } from "@/shared/enums";
import type { SpatialLinkLine } from "@/lib/riskHeatmap";
import {
  hasAnyOpsChip,
  type AssetOpsChips,
} from "@/lib/opsChips";
import floorPlanMap from "@/lib/floor_plan_map.json";
import { SpatialLinksLayer } from "./SpatialLinksLayer";
import { AssetMarker } from "./AssetMarker";
import { MAP_VIEWBOX, MAP_WORLD } from "./MapViewport";
import { loadFloorSchematic } from "./floorPlanShared";
import styles from "./FloorPlan.module.css";

type HoverTip = {
  assetId: string;
  label: string;
  risk: RiskLevel;
  riskLabel: string;
  fresh: boolean;
  /** When set, tooltip is for an ops chip rather than the asset hit region. */
  opsDetail?: string;
  x: number;
  y: number;
  place: "above" | "below";
};

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

type ZoneSeverity = "elevated" | "blocking" | "critical";

type ZoneHalo = {
  zone: string;
  x: number;
  y: number;
  w: number;
  h: number;
  severity: ZoneSeverity;
};

interface FloorPlanProps {
  floor: PlantFloor;
  riskByAsset: Record<string, RiskLevel>;
  criticalByAsset?: Record<string, boolean>;
  resolvedByAsset?: Record<string, boolean>;
  freshByAsset?: Record<string, boolean>;
  selectedAssetId: string | null;
  onSelectAsset: (id: string | null) => void;
  spatialLinks?: SpatialLinkLine[];
  /** Per-asset permit / isolation / occupancy chips. */
  opsChipsByAsset?: Record<string, AssetOpsChips>;
  /** When true, render the ops chip layer. */
  showOpsLayer?: boolean;
}

const MAP = floorPlanMap as Record<string, FloorEntry>;
const ZONE_HALO_PAD = 20;

const RISK_RANK: Record<RiskLevel, number> = {
  nominal: 0,
  elevated: 1,
  blocking: 2,
};

function tipFromTarget(
  assetId: string,
  entry: FloorEntry,
  risk: RiskLevel,
  resolved: boolean,
  fresh: boolean,
  target: SVGGraphicsElement,
): HoverTip {
  const rect = target.getBoundingClientRect();
  const place = rect.top < 56 ? "below" : "above";
  const riskLabel = resolved ? "halted" : risk;
  return {
    assetId,
    label: entry.label,
    risk,
    riskLabel,
    fresh,
    x: rect.left + rect.width / 2,
    y: place === "above" ? rect.top : rect.bottom,
    place,
  };
}

function buildZoneHalos(
  floorEntries: [string, FloorEntry][],
  riskByAsset: Record<string, RiskLevel>,
  criticalByAsset: Record<string, boolean>,
): ZoneHalo[] {
  const byZone = new Map<
    string,
    { hits: HitBox[]; worstRank: number; critical: boolean }
  >();

  for (const [assetId, entry] of floorEntries) {
    if (!entry.hit) continue;
    const risk = riskByAsset[assetId] ?? "nominal";
    const critical = criticalByAsset[assetId] ?? false;
    const rank = RISK_RANK[risk] ?? 0;
    if (rank === 0 && !critical) continue;

    const cur = byZone.get(entry.zone) ?? {
      hits: [],
      worstRank: 0,
      critical: false,
    };
    cur.hits.push(entry.hit);
    cur.worstRank = Math.max(cur.worstRank, rank);
    cur.critical = cur.critical || critical;
    byZone.set(entry.zone, cur);
  }

  const halos: ZoneHalo[] = [];
  for (const [zone, data] of byZone) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const hit of data.hits) {
      minX = Math.min(minX, hit.x);
      minY = Math.min(minY, hit.y);
      maxX = Math.max(maxX, hit.x + hit.w);
      maxY = Math.max(maxY, hit.y + hit.h);
    }
    if (!Number.isFinite(minX)) continue;

    const severity: ZoneSeverity = data.critical
      ? "critical"
      : data.worstRank >= 2
        ? "blocking"
        : "elevated";

    halos.push({
      zone,
      x: minX - ZONE_HALO_PAD,
      y: minY - ZONE_HALO_PAD,
      w: maxX - minX + ZONE_HALO_PAD * 2,
      h: maxY - minY + ZONE_HALO_PAD * 2,
      severity,
    });
  }
  return halos;
}

/** Circular ops badges — sized to read next to AssetMarker disks (r≈10). */
const OPS_R = 13;
const OPS_GAP = 5;
const OPS_ICON = 16;
const OPS_ICON_SCALE = 0.72;

function tipFromSvgTarget(
  target: SVGGraphicsElement,
): Pick<HoverTip, "x" | "y" | "place"> {
  const rect = target.getBoundingClientRect();
  const place = rect.top < 56 ? "below" : "above";
  return {
    x: rect.left + rect.width / 2,
    y: place === "above" ? rect.top : rect.bottom,
    place,
  };
}

type OpsItem = {
  key: string;
  warn: boolean;
  label: string;
  /** Icon paths in a 16×16 viewBox, centered on the disk. */
  paths: string[];
};

function OpsChipIcons({
  chips,
  x,
  y,
  assetId,
  assetLabel,
  risk,
  onSelect,
  onHover,
  onLeave,
}: {
  chips: AssetOpsChips;
  x: number;
  y: number;
  assetId: string;
  assetLabel: string;
  risk: RiskLevel;
  onSelect: (id: string) => void;
  onHover: (tip: HoverTip) => void;
  onLeave: (assetId: string) => void;
}) {
  const items: OpsItem[] = [];

  if (chips.hasPermit) {
    items.push({
      key: "permit",
      warn: chips.permitActive,
      label: chips.permitActive ? "Active permit" : "Permit",
      paths: [
        "M5 2.5h4.2L12.5 5.8V13.5H5V2.5Z",
        "M9.2 2.5V5.8H12.5",
        "M7 8h3.5M7 10.5h2.5",
      ],
    });
  }
  if (chips.hasIsolation) {
    items.push({
      key: "isolation",
      warn: chips.isolationIncomplete,
      label: chips.isolationIncomplete
        ? "Isolation incomplete"
        : "Isolation complete",
      paths: [
        "M5.5 7.2V5.4a2.5 2.5 0 0 1 5 0v1.8",
        "M4.5 7.2h7v5.8h-7V7.2Z",
        "M8 9.2v2",
      ],
    });
  }
  if (chips.workerCount > 0 || chips.workerHazardous) {
    items.push({
      key: "worker",
      warn: chips.workerHazardous,
      label: chips.workerHazardous
        ? "Hazardous occupancy"
        : `Workers · ${chips.workerCount}`,
      paths: [
        "M8 3.2a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2Z",
        "M4.2 13.2c0-2.1 1.7-3.6 3.8-3.6s3.8 1.5 3.8 3.6",
      ],
    });
  }

  if (items.length === 0) return null;

  const diam = OPS_R * 2;
  const totalW = items.length * diam + (items.length - 1) * OPS_GAP;
  const startX = x - totalW;
  // Center the row vertically on the anchor y.
  const cy = y + OPS_R;

  return (
    <g className={styles.opsChipRow}>
      {items.map((item, i) => {
        const cx = startX + OPS_R + i * (diam + OPS_GAP);
        return (
          <g
            key={item.key}
            className={styles.opsChip}
            data-warn={item.warn ? "true" : undefined}
            transform={`translate(${cx}, ${cy})`}
          >
            <circle
              className={styles.opsChipBg}
              r={OPS_R}
              role="button"
              tabIndex={-1}
              aria-label={`${assetLabel}: ${item.label}`}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseEnter={(e) => {
                if (!(e.currentTarget instanceof SVGGraphicsElement)) return;
                const pos = tipFromSvgTarget(e.currentTarget);
                onHover({
                  assetId,
                  label: assetLabel,
                  risk,
                  riskLabel: risk,
                  fresh: false,
                  opsDetail: item.label,
                  ...pos,
                });
              }}
              onMouseLeave={() => onLeave(assetId)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(assetId);
              }}
            />
            <g
              className={styles.opsChipIcon}
              transform={`translate(${-OPS_ICON / 2}, ${-OPS_ICON / 2}) scale(${OPS_ICON_SCALE})`}
              pointerEvents="none"
            >
              {item.paths.map((d) => (
                <path
                  key={d}
                  d={d}
                  fill="none"
                  strokeWidth={1.35}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          </g>
        );
      })}
    </g>
  );
}

export const FloorPlan = memo(function FloorPlan({
  floor,
  riskByAsset,
  criticalByAsset = {},
  resolvedByAsset = {},
  freshByAsset = {},
  selectedAssetId,
  onSelectAsset,
  spatialLinks = [],
  opsChipsByAsset = {},
  showOpsLayer = false,
}: FloorPlanProps) {
  const [schematic, setSchematic] = useState<string>("");
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);
  const [mounted, setMounted] = useState(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const floorEntries = useMemo(
    () =>
      Object.entries(MAP).filter(
        ([, entry]) => (entry.floor ?? "ground") === floor,
      ),
    [floor],
  );

  const zoneHalos = useMemo(
    () => buildZoneHalos(floorEntries, riskByAsset, criticalByAsset),
    [floorEntries, riskByAsset, criticalByAsset],
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

  const showTipOnEnter = (
    assetId: string,
    entry: FloorEntry,
    risk: RiskLevel,
    resolved: boolean,
    fresh: boolean,
    target: EventTarget | null,
  ) => {
    if (!(target instanceof SVGGraphicsElement)) return;
    setHoveredAssetId(assetId);
    setHoverTip(tipFromTarget(assetId, entry, risk, resolved, fresh, target));
  };

  const clearTip = (assetId: string) => {
    setHoveredAssetId((cur) => (cur === assetId ? null : cur));
    setHoverTip((cur) => (cur?.assetId === assetId ? null : cur));
  };

  const onCanvasPointerDown = (e: PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  };

  const onCanvasClick = (e: MouseEvent) => {
    const start = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Ignore pans — only clear selection on a true click.
    if (dx * dx + dy * dy > 36) return;
    onSelectAsset(null);
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
            <rect width="18" height="18" className={styles.canvasBg} />
            <circle className={styles.canvasDot} cx="1.5" cy="1.5" r="1.1" />
          </pattern>
        </defs>

        <rect
          x={0}
          y={0}
          width={MAP_VIEWBOX.width}
          height={MAP_VIEWBOX.height}
          fill={`url(#canvas-dots-${floor})`}
          onPointerDown={onCanvasPointerDown}
          onClick={onCanvasClick}
        />
        {schematic ? (
          <g
            className={`${styles.schematic} fps-root`}
            pointerEvents="none"
            dangerouslySetInnerHTML={{ __html: schematic }}
          />
        ) : null}

        {/* Zone risk halos — under hit regions, above schematic */}
        {zoneHalos.map((halo) => (
          <rect
            key={`halo-${halo.zone}`}
            className={styles.zoneHalo}
            data-severity={halo.severity}
            x={halo.x}
            y={halo.y}
            width={halo.w}
            height={halo.h}
            rx={14}
            ry={14}
            pointerEvents="none"
            aria-hidden
          />
        ))}

        {floorEntries.map(([assetId, entry]) => {
          if (!entry.hit) return null;
          const risk = riskByAsset[assetId] ?? "nominal";
          const sensorCritical = criticalByAsset[assetId] ?? false;
          const resolved = resolvedByAsset[assetId] ?? false;
          const fresh = freshByAsset[assetId] ?? false;
          const selected = selectedAssetId === assetId;
          const { x, y, w, h, angle } = entry.hit;
          const cx = x + w / 2;
          const cy = y + h / 2;
          const hitRect = (
            <rect
              className={styles.hitRegion}
              data-risk={resolved ? "halted" : risk}
              data-sensor-critical={sensorCritical ? "true" : undefined}
              data-selected={selected ? "true" : undefined}
              data-map-marker=""
              data-svg-id={entry.svg_element_id}
              x={x}
              y={y}
              width={w}
              height={h}
              role="button"
              aria-label={`${entry.label}, ${resolved ? "work halted" : `risk ${risk}`}${fresh ? ", new data" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onMouseEnter={(e) =>
                showTipOnEnter(assetId, entry, risk, resolved, fresh, e.currentTarget)
              }
              onMouseLeave={() => clearTip(assetId)}
              onClick={(e) => {
                e.stopPropagation();
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
          const sensorCritical = criticalByAsset[assetId] ?? false;
          const resolved = resolvedByAsset[assetId] ?? false;
          const fresh = freshByAsset[assetId] ?? false;
          if (risk === "nominal" && !sensorCritical && !resolved && !fresh && entry.hit) {
            return null;
          }
          return (
            <AssetMarker
              key={assetId}
              id={assetId}
              label={entry.label}
              x={entry.x}
              y={entry.y}
              risk={risk}
              sensorCritical={sensorCritical}
              resolved={resolved}
              fresh={fresh}
              selected={selectedAssetId === assetId}
              hovered={hoveredAssetId === assetId}
              onSelect={onSelectAsset}
            />
          );
        })}

        {/* Ops chips above markers so they stay readable */}
        {showOpsLayer
          ? floorEntries.map(([assetId, entry]) => {
              if (!entry.hit) return null;
              const chips = opsChipsByAsset[assetId];
              if (!hasAnyOpsChip(chips)) return null;
              const { x, y, w } = entry.hit;
              const risk = riskByAsset[assetId] ?? "nominal";
              return (
                <OpsChipIcons
                  key={`ops-${assetId}`}
                  chips={chips!}
                  x={x + w - 8}
                  y={y + 8}
                  assetId={assetId}
                  assetLabel={entry.label}
                  risk={risk}
                  onSelect={onSelectAsset}
                  onHover={(tip) => {
                    setHoveredAssetId(assetId);
                    setHoverTip(tip);
                  }}
                  onLeave={clearTip}
                />
              );
            })
          : null}
      </svg>

      <SpatialLinksLayer links={spatialLinks} />

      {mounted &&
        hoverTip &&
        createPortal(
          <div
            className={styles.tooltip}
            data-risk={hoverTip.opsDetail ? undefined : hoverTip.riskLabel}
            data-kind={hoverTip.opsDetail ? "ops" : "risk"}
            data-place={hoverTip.place}
            data-fresh={hoverTip.fresh ? "true" : undefined}
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
            {hoverTip.opsDetail ? (
              <>
                <span className={styles.tooltipSep} aria-hidden>
                  ·
                </span>
                <span className={styles.tooltipOps}>{hoverTip.opsDetail}</span>
              </>
            ) : (
              <span className={styles.tooltipRisk}>{hoverTip.riskLabel}</span>
            )}
            {hoverTip.fresh ? (
              <span className={styles.tooltipFresh} aria-label="New data">
                New
              </span>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
});
