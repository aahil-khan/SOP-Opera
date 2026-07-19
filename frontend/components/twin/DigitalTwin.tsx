"use client";

import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import {
  findViewByAssetId,
  getLiveAssetViews,
  useLiveStore,
} from "@/lib/liveStore";
import floorPlanMap from "@/lib/floor_plan_map.json";
import type { PlantFloor, RiskLevel } from "@/shared/enums";
import { FloorPlan } from "./FloorPlan";
import { FloorOverview } from "./FloorOverview";
import { FloorNavArrows } from "./FloorNavArrows";
import { AssetPanel } from "./AssetPanel";
import { TelemetryStrip } from "./TelemetryStrip";
import { ImpactStrip } from "./ImpactStrip";
import { ReviewSidebar } from "./ReviewSidebar";
import { ShiftGate, hasStartedShift } from "./ShiftGate";
import { MapControls } from "./MapControls";
import { MapViewport, type MapViewportHandle } from "./MapViewport";
import { FLOOR_LABELS, FLOOR_ORDER } from "./floorPlanShared";
import styles from "./DigitalTwin.module.css";

type FloorEntry = {
  x: number;
  y: number;
  hit?: { x: number; y: number; w: number; h: number };
  floor?: PlantFloor;
};

type ViewMode = "overview" | "detail";
type SlideDir = "left" | "right" | "in";

const MAP = floorPlanMap as Record<string, FloorEntry>;

function floorOfAsset(assetId: string, assetFloor?: string): PlantFloor {
  const mapped = MAP[assetId]?.floor;
  if (mapped) return mapped;
  if (assetFloor === "first" || assetFloor === "second" || assetFloor === "ground") {
    return assetFloor;
  }
  return "ground";
}

function floorIndex(floor: PlantFloor): number {
  return FLOOR_ORDER.indexOf(floor);
}

export function DigitalTwin() {
  const assets = useLiveStore((s) => s.assets);
  const reviews = useLiveStore((s) => s.reviews);
  const reviewDetails = useLiveStore((s) => s.reviewDetails);
  const assessmentsByReview = useLiveStore((s) => s.assessmentsByReview);
  const selectedAssetId = useLiveStore((s) => s.selectedAssetId);
  const selectAsset = useLiveStore((s) => s.selectAsset);

  const mapRef = useRef<MapViewportHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeFloor, setActiveFloor] = useState<PlantFloor>("ground");
  const [slideDir, setSlideDir] = useState<SlideDir>("in");
  const [shiftGateOpen, setShiftGateOpen] = useState(false);
  const lastFocusedRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => {
    setShiftGateOpen(!hasStartedShift());
  }, []);

  const handleStartShift = useCallback(
    (attentionAssetId: string | null) => {
      setShiftGateOpen(false);
      if (attentionAssetId) {
        selectAsset(attentionAssetId);
      }
    },
    [selectAsset],
  );

  const views = getLiveAssetViews({
    assets,
    reviews,
    reviewDetails,
    assessmentsByReview,
  });

  const riskByAsset: Record<string, RiskLevel> = {};
  for (const v of views) {
    riskByAsset[v.asset.id] = v.risk_level;
  }

  const selected = selectedAssetId
    ? findViewByAssetId(views, selectedAssetId)
    : null;

  const affectedCount = views.filter(
    (v) =>
      v.review != null ||
      (v.risk_level !== "nominal" && v.detail?.derived_facts?.length),
  ).length;

  const activityByFloor: Record<PlantFloor, number> = {
    ground: 0,
    first: 0,
    second: 0,
  };
  for (const v of views) {
    const active =
      v.review != null &&
      v.review.state !== "closed" &&
      v.review.state !== "decided";
    const elevated = v.risk_level !== "nominal";
    if (!active && !elevated) continue;
    const floor = floorOfAsset(v.asset.id, v.asset.floor);
    activityByFloor[floor] += 1;
  }

  const idx = floorIndex(activeFloor);
  const prevFloor = idx > 0 ? FLOOR_ORDER[idx - 1] : null;
  const nextFloor = idx < FLOOR_ORDER.length - 1 ? FLOOR_ORDER[idx + 1] : null;

  const enterFloor = useCallback((floor: PlantFloor, dir: SlideDir = "in") => {
    setSlideDir(dir);
    startTransition(() => {
      setActiveFloor(floor);
      setViewMode("detail");
    });
    lastFocusedRef.current = null;
  }, []);

  /** Manual floor change: leave any selected asset so nav isn't snapped back. */
  const navigateFloor = useCallback(
    (floor: PlantFloor, dir: SlideDir = "in") => {
      selectAsset(null);
      pendingFocusRef.current = null;
      enterFloor(floor, dir);
    },
    [enterFloor, selectAsset],
  );

  const showOverview = useCallback(() => {
    setViewMode("overview");
    lastFocusedRef.current = null;
    pendingFocusRef.current = null;
    selectAsset(null);
  }, [selectAsset]);

  const goPrevFloor = useCallback(() => {
    if (!prevFloor) return;
    navigateFloor(prevFloor, "right");
  }, [prevFloor, navigateFloor]);

  const goNextFloor = useCallback(() => {
    if (!nextFloor) return;
    navigateFloor(nextFloor, "left");
  }, [nextFloor, navigateFloor]);

  // Fit the map after switching into detail (viewport remounts per floor key).
  useEffect(() => {
    if (viewMode !== "detail") return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      mapRef.current?.resetView();
      const focusId = pendingFocusRef.current;
      if (!focusId) return;
      const entry = MAP[focusId];
      if (!entry) return;
      pendingFocusRef.current = null;
      lastFocusedRef.current = focusId;
      mapRef.current?.focusOn(
        { x: entry.x, y: entry.y },
        entry.hit ? { bounds: entry.hit } : undefined,
      );
    }, 40);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [viewMode, activeFloor]);

  // Re-center after the affected-areas inset animates open/closed.
  useEffect(() => {
    if (viewMode !== "detail") return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (cancelled) return;
      const focusId = lastFocusedRef.current;
      if (focusId) {
        const entry = MAP[focusId];
        if (entry) {
          mapRef.current?.focusOn(
            { x: entry.x, y: entry.y },
            entry.hit ? { bounds: entry.hit } : undefined,
          );
          return;
        }
      }
      mapRef.current?.resetView();
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [sidebarOpen, viewMode]);

  useEffect(() => {
    if (!selectedAssetId) {
      lastFocusedRef.current = null;
      return;
    }
    const entry = MAP[selectedAssetId];
    const floor = floorOfAsset(selectedAssetId, selected?.asset.floor);

    if (viewMode !== "detail" || floor !== activeFloor) {
      pendingFocusRef.current = selectedAssetId;
      enterFloor(floor, "in");
      return;
    }

    if (lastFocusedRef.current === selectedAssetId) return;
    if (!entry) return;
    lastFocusedRef.current = selectedAssetId;
    mapRef.current?.focusOn(
      { x: entry.x, y: entry.y },
      entry.hit ? { bounds: entry.hit } : undefined,
    );
  }, [
    selectedAssetId,
    activeFloor,
    viewMode,
    selected?.asset.floor,
    enterFloor,
  ]);

  useEffect(() => {
    if (viewMode !== "detail") return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevFloor();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNextFloor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (selectedAssetId) {
          selectAsset(null);
        } else {
          showOverview();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, goPrevFloor, goNextFloor, showOverview, selectedAssetId, selectAsset]);

  return (
    <div className={styles.wrap}>
      <div
        className={styles.stage}
        data-affected-inset={sidebarOpen ? "true" : undefined}
      >
        {viewMode === "overview" ? (
          <FloorOverview
            riskByAsset={riskByAsset}
            activityByFloor={activityByFloor}
            onSelectFloor={(floor) => enterFloor(floor, "in")}
          />
        ) : (
          <div
            key={activeFloor}
            className={styles.detailPane}
            data-slide={slideDir}
          >
            <MapViewport ref={mapRef}>
              <FloorPlan
                floor={activeFloor}
                riskByAsset={riskByAsset}
                selectedAssetId={selectedAssetId}
                onSelectAsset={selectAsset}
              />
            </MapViewport>
          </div>
        )}

        <div className={styles.floorTabs} role="tablist" aria-label="Plant floors">
          {FLOOR_ORDER.map((id) => {
            const selected = viewMode === "detail" && activeFloor === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={styles.floorTab}
                data-active={selected ? "true" : undefined}
                onClick={() => {
                  if (selected) {
                    mapRef.current?.resetView();
                    return;
                  }
                  const from = floorIndex(activeFloor);
                  const to = floorIndex(id);
                  const dir: SlideDir =
                    viewMode === "overview"
                      ? "in"
                      : to > from
                        ? "left"
                        : "right";
                  navigateFloor(id, dir);
                }}
              >
                {FLOOR_LABELS[id]}
                {activityByFloor[id] > 0 ? (
                  <span className={styles.floorBadge}>{activityByFloor[id]}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {legendOpen ? (
          <div
            id="twin-legend"
            className={styles.legend}
            data-shift={selected && viewMode === "detail" ? "true" : undefined}
            role="group"
            aria-label="Risk legend"
          >
            <span>
              <span className={`${styles.swatch} ${styles.swatchNominal}`} />
              Nominal
            </span>
            <span>
              <span className={`${styles.swatch} ${styles.swatchElevated}`} />
              Elevated
            </span>
            <span>
              <span className={`${styles.swatch} ${styles.swatchBlocking}`} />
              Blocking
            </span>
          </div>
        ) : null}

        {viewMode === "detail" ? (
          <FloorNavArrows
            canGoPrev={Boolean(prevFloor)}
            canGoNext={Boolean(nextFloor)}
            prevLabel={prevFloor ? FLOOR_LABELS[prevFloor] : "Ground"}
            nextLabel={nextFloor ? FLOOR_LABELS[nextFloor] : "Second"}
            onPrev={goPrevFloor}
            onNext={goNextFloor}
            shiftForSidebar={sidebarOpen}
            shiftForDrawer={Boolean(selected)}
          />
        ) : null}

        <MapControls
          onZoomIn={() => mapRef.current?.zoomIn()}
          onZoomOut={() => mapRef.current?.zoomOut()}
          onReset={() => mapRef.current?.resetView()}
          onOverview={viewMode === "detail" ? showOverview : undefined}
          legendOpen={legendOpen}
          onToggleLegend={() => setLegendOpen((open) => !open)}
          shiftForDrawer={Boolean(selected) && viewMode === "detail"}
        />

        {selected && viewMode === "detail" ? (
          <AssetPanel view={selected} onClose={() => selectAsset(null)} />
        ) : null}

        <ImpactStrip
          shiftForDrawer={Boolean(selected) && viewMode === "detail"}
        />

        <TelemetryStrip
          shiftForDrawer={Boolean(selected) && viewMode === "detail"}
        />
      </div>

      <ReviewSidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        affectedCount={affectedCount}
      />

      {shiftGateOpen ? <ShiftGate onStartShift={handleStartShift} /> : null}
    </div>
  );
}
