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
import markerStyles from "./AssetMarker.module.css";
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
  /** Tour cast-select: only this asset's hit target gets `data-tour`. */
  tourTargetAssetId?: string | null;
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

/** Circular ops badges — anchored to asset hit boundary top-right. */
const OPS_R = 16;
const OPS_GAP = 5;
/** Icon square inside the disk (viewBox 0 0 16 16). */
const OPS_ICON_SIZE = 14;

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
  // (x, y) = top-right corner of the asset hit boundary; chips grow leftward.
  const totalW = items.length * diam + (items.length - 1) * OPS_GAP;
  const startX = x - totalW;
  const cy = y;

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
            <svg
              className={styles.opsChipIcon}
              x={-OPS_ICON_SIZE / 2}
              y={-OPS_ICON_SIZE / 2}
              width={OPS_ICON_SIZE}
              height={OPS_ICON_SIZE}
              viewBox="0 0 16 16"
              aria-hidden
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
            </svg>
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
  tourTargetAssetId = null,
}: FloorPlanProps) {
  const [schematic, setSchematic] = useState<string>("");
  const [mounted, setMounted] = useState(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tipNameRef = useRef<HTMLSpanElement | null>(null);
  const tipSepRef = useRef<HTMLSpanElement | null>(null);
  const tipOpsRef = useRef<HTMLSpanElement | null>(null);
  const tipRiskRef = useRef<HTMLSpanElement | null>(null);
  const tipFreshRef = useRef<HTMLSpanElement | null>(null);
  const tipMetaRef = useRef<HTMLDivElement | null>(null);
  const markerEls = useRef(new Map<string, SVGGElement>());
  const hoveredAssetIdRef = useRef<string | null>(null);

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

  const clearMarkerHover = () => {
    const prev = hoveredAssetIdRef.current;
    if (!prev) return;
    markerEls.current.get(prev)?.classList.remove(markerStyles.hovered);
    hoveredAssetIdRef.current = null;
  };

  const paintTip = (tip: HoverTip | null) => {
    const root = tipRef.current;
    if (!root) return;

    clearMarkerHover();

    if (!tip) {
      root.style.visibility = "hidden";
      root.dataset.visible = "false";
      delete root.dataset.risk;
      delete root.dataset.kind;
      delete root.dataset.place;
      delete root.dataset.fresh;
      return;
    }

    hoveredAssetIdRef.current = tip.assetId;
    markerEls.current.get(tip.assetId)?.classList.add(markerStyles.hovered);

    const isOps = Boolean(tip.opsDetail);
    if (isOps) {
      delete root.dataset.risk;
      root.dataset.kind = "ops";
    } else {
      root.dataset.risk = tip.riskLabel;
      root.dataset.kind = "risk";
    }
    root.dataset.place = tip.place;
    if (tip.fresh) root.dataset.fresh = "true";
    else delete root.dataset.fresh;

    root.style.left = `${tip.x}px`;
    root.style.top = `${tip.y}px`;
    root.style.visibility = "visible";
    root.dataset.visible = "true";

    if (tipMetaRef.current) tipMetaRef.current.hidden = isOps;

    if (tipNameRef.current) tipNameRef.current.textContent = tip.label;

    if (tipSepRef.current) tipSepRef.current.hidden = !isOps;
    if (tipOpsRef.current) {
      tipOpsRef.current.hidden = !isOps;
      tipOpsRef.current.textContent = tip.opsDetail ?? "";
    }
    if (tipRiskRef.current) {
      tipRiskRef.current.hidden = isOps;
      tipRiskRef.current.textContent = tip.riskLabel;
    }
    if (tipFreshRef.current) tipFreshRef.current.hidden = !tip.fresh;

    requestAnimationFrame(() => {
      if (root.dataset.visible !== "true") return;
      const half = root.offsetWidth / 2;
      const margin = 12;
      const clampedX = Math.min(
        Math.max(tip.x, half + margin),
        window.innerWidth - half - margin,
      );
      root.style.left = `${clampedX}px`;
    });
  };

  const showTipOnEnter = (
    assetId: string,
    entry: FloorEntry,
    risk: RiskLevel,
    resolved: boolean,
    fresh: boolean,
    target: EventTarget | null,
  ) => {
    if (!(target instanceof SVGGraphicsElement)) return;
    paintTip(tipFromTarget(assetId, entry, risk, resolved, fresh, target));
  };

  const clearTip = (assetId: string) => {
    if (hoveredAssetIdRef.current !== assetId) return;
    paintTip(null);
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
              data-tour={
                tourTargetAssetId === assetId ? "hero-marker" : undefined
              }
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
          const hasOps =
            showOpsLayer && hasAnyOpsChip(opsChipsByAsset[assetId]);
          if (
            risk === "nominal" &&
            !sensorCritical &&
            !resolved &&
            !fresh &&
            !hasOps &&
            entry.hit
          ) {
            return null;
          }
          return (
            <AssetMarker
              key={assetId}
              ref={(node) => {
                if (node) markerEls.current.set(assetId, node);
                else markerEls.current.delete(assetId);
              }}
              id={assetId}
              label={entry.label}
              x={entry.x}
              y={entry.y}
              risk={risk}
              sensorCritical={sensorCritical}
              resolved={resolved}
              fresh={fresh}
              selected={selectedAssetId === assetId}
              onSelect={onSelectAsset}
            />
          );
        })}

        {/* Ops chips — top-right of each asset hit boundary */}
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
                  y={y + OPS_R}
                  assetId={assetId}
                  assetLabel={entry.label}
                  risk={risk}
                  onSelect={onSelectAsset}
                  onHover={paintTip}
                  onLeave={clearTip}
                />
              );
            })
          : null}
      </svg>

      <SpatialLinksLayer links={spatialLinks} />

      {mounted &&
        createPortal(
          <div
            ref={tipRef}
            className={styles.tooltip}
            data-visible="false"
            style={{ visibility: "hidden", left: 0, top: 0 }}
            role="tooltip"
          >
            <div className={styles.tooltipLead}>
              <span className={styles.tooltipDot} aria-hidden />
              <span ref={tipNameRef} className={styles.tooltipName} />
              <span ref={tipSepRef} className={styles.tooltipSep} aria-hidden hidden>
                ·
              </span>
              <span ref={tipOpsRef} className={styles.tooltipOps} hidden />
            </div>
            <div ref={tipMetaRef} className={styles.tooltipMeta}>
              <span ref={tipRiskRef} className={styles.tooltipRisk} hidden />
              <span
                ref={tipFreshRef}
                className={styles.tooltipFresh}
                aria-label="New data"
                hidden
              >
                New
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
});
