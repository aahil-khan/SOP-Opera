"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type CSSProperties,
} from "react";
import {
  findViewByAssetId,
  useLiveAssetViews,
  useLiveStore,
} from "@/lib/liveStore";
import { columnForView } from "@/lib/openWork";
import floorPlanMap from "@/lib/floor_plan_map.json";
import { buildFloorSpatialLinks } from "@/lib/riskHeatmap";
import { useNewEntries } from "@/lib/useNewEntries";
import { useNewReviewChime } from "@/lib/useNewReviewChime";
import type { PlantFloor, RiskLevel } from "@/shared/enums";
import { FloorPlan } from "./FloorPlan";
import { FloorOverview } from "./FloorOverview";
import { FloorNavArrows } from "./FloorNavArrows";
import { AssetPanel } from "./AssetPanel";
import { ReviewSidebar } from "./ReviewSidebar";
import { MapControls, type MapLayerId } from "./MapControls";
import { MapViewport, type MapViewportHandle } from "./MapViewport";
import { FLOOR_LABELS, FLOOR_ORDER } from "./floorPlanShared";
import styles from "./DigitalTwin.module.css";

const MAP_LAYERS_STORAGE_KEY = "sop-opera-map-layers";
const DEFAULT_ENABLED_LAYERS: MapLayerId[] = ["ops"];

function readEnabledLayers(): Set<MapLayerId> {
  if (typeof window === "undefined") return new Set(DEFAULT_ENABLED_LAYERS);
  try {
    const raw = localStorage.getItem(MAP_LAYERS_STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_ENABLED_LAYERS);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set(DEFAULT_ENABLED_LAYERS);
    const next = new Set<MapLayerId>();
    for (const id of parsed) {
      if (id === "ops") next.add(id);
    }
    return next;
  } catch {
    return new Set(DEFAULT_ENABLED_LAYERS);
  }
}

function writeEnabledLayers(enabled: Set<MapLayerId>) {
  try {
    localStorage.setItem(
      MAP_LAYERS_STORAGE_KEY,
      JSON.stringify([...enabled]),
    );
  } catch {
    /* ignore */
  }
}

type FloorEntry = {
  x: number;
  y: number;
  hit?: { x: number; y: number; w: number; h: number };
  floor?: PlantFloor;
};

type ViewMode = "overview" | "detail";
type SlideDir = "left" | "right" | "in" | "out";

/** Camera pull-back / dive-in duration for overview ↔ detail. */
const VIEW_ZOOM_MS = 420;

/** Docked panel widths — current defaults are mins; user can widen only. */
export const SIDEBAR_WIDTH_MIN = 280;
export const SIDEBAR_WIDTH_MAX = 480;
export const DRAWER_WIDTH_MIN = 380;
export const DRAWER_WIDTH_EXPANDED_MIN = 720;
export const DRAWER_WIDTH_MAX = 960;

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
  const views = useLiveAssetViews();
  const selectedAssetId = useLiveStore((s) => s.selectedAssetId);
  const assetPanelMode = useLiveStore((s) => s.assetPanelMode);
  const selectAsset = useLiveStore((s) => s.selectAsset);
  const opsChipsByAsset = useLiveStore((s) => s.opsChipsByAsset);
  const opsAssetCount = useLiveStore((s) => s.opsSummary.assetsWithOps);

  const mapRef = useRef<MapViewportHandle>(null);
  const floorTablistRef = useRef<HTMLDivElement>(null);
  const floorTabRefs = useRef<Partial<Record<"all" | PlantFloor, HTMLButtonElement | null>>>(
    {},
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_MIN);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(DRAWER_WIDTH_MIN);
  const [drawerResizing, setDrawerResizing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [activeFloor, setActiveFloor] = useState<PlantFloor>("ground");
  const [slideDir, setSlideDir] = useState<SlideDir>("in");
  /** Overview is diving into a floor before detail mounts. */
  const [overviewExiting, setOverviewExiting] = useState(false);
  const [floorSlider, setFloorSlider] = useState({ left: 0, width: 0 });
  const [enabledLayers, setEnabledLayers] = useState<Set<MapLayerId>>(
    () => new Set(DEFAULT_ENABLED_LAYERS),
  );
  const lastFocusedRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const viewTransitionTimerRef = useRef<number | null>(null);
  /** Summary-mode width to restore after leaving full review. */
  const summaryDrawerWidthRef = useRef(DRAWER_WIDTH_MIN);
  const prevAssetPanelModeRef = useRef(assetPanelMode);

  const drawerMin =
    assetPanelMode === "fullReview" ? DRAWER_WIDTH_EXPANDED_MIN : DRAWER_WIDTH_MIN;
  const effectiveDrawerWidth = Math.min(
    DRAWER_WIDTH_MAX,
    Math.max(drawerMin, drawerWidth),
  );

  useEffect(() => {
    const prev = prevAssetPanelModeRef.current;
    if (prev === assetPanelMode) return;
    prevAssetPanelModeRef.current = assetPanelMode;

    if (assetPanelMode === "fullReview") {
      summaryDrawerWidthRef.current = drawerWidth;
      if (drawerWidth < DRAWER_WIDTH_EXPANDED_MIN) {
        setDrawerWidth(DRAWER_WIDTH_EXPANDED_MIN);
      }
      return;
    }

    if (prev === "fullReview") {
      setDrawerWidth(summaryDrawerWidthRef.current);
    }
  }, [assetPanelMode, drawerWidth]);

  const activeFloorTab: "all" | PlantFloor =
    viewMode === "overview" || slideDir === "out" ? "all" : activeFloor;

  const clearViewTransition = useCallback(() => {
    if (viewTransitionTimerRef.current != null) {
      window.clearTimeout(viewTransitionTimerRef.current);
      viewTransitionTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearViewTransition(), [clearViewTransition]);

  useEffect(() => {
    setEnabledLayers(readEnabledLayers());
  }, []);

  const toggleLayer = useCallback((id: MapLayerId) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeEnabledLayers(next);
      return next;
    });
  }, []);

  const {
    riskByAsset,
    criticalByAsset,
    resolvedByAsset,
    affectedCount,
    activityByFloor,
  } = useMemo(() => {
    const risk: Record<string, RiskLevel> = {};
    const critical: Record<string, boolean> = {};
    const resolved: Record<string, boolean> = {};
    let affected = 0;
    const activity: Record<PlantFloor, number> = {
      ground: 0,
      first: 0,
      second: 0,
    };
    for (const v of views) {
      risk[v.asset.id] = v.risk_level;
      if (v.sensor_critical) critical[v.asset.id] = true;
      if (
        v.review != null &&
        v.review.state === "closed" &&
        v.detail?.decision?.outcome === "blocked"
      ) {
        resolved[v.asset.id] = true;
      }
      if (
        v.review != null ||
        (v.risk_level !== "nominal" && v.detail?.derived_facts?.length)
      ) {
        affected += 1;
      }
      const isActive =
        v.review != null &&
        v.review.state !== "closed" &&
        v.review.state !== "decided";
      const elevated = v.risk_level !== "nominal";
      if (!isActive && !elevated) continue;
      const floor = floorOfAsset(v.asset.id, v.asset.floor);
      activity[floor] += 1;
    }
    return {
      riskByAsset: risk,
      criticalByAsset: critical,
      resolvedByAsset: resolved,
      affectedCount: affected,
      activityByFloor: activity,
    };
  }, [views]);

  /** Same entry keys as ReviewSidebar — green "new" cue on the map. */
  const workEntryIds = useMemo(
    () =>
      views
        .filter(
          (v) =>
            v.review != null ||
            (v.risk_level !== "nominal" && v.detail?.derived_facts?.length),
        )
        .map((v) => v.review?.id ?? `signal:${v.asset.id}`),
    [views],
  );
  const { isNew } = useNewEntries(workEntryIds);

  const reviewIds = useMemo(
    () => views.map((v) => v.review?.id).filter((id): id is string => Boolean(id)),
    [views],
  );
  useNewReviewChime(reviewIds);

  const { freshByAsset, freshByFloor } = useMemo(() => {
    const byAsset: Record<string, boolean> = {};
    const byFloor: Record<PlantFloor, boolean> = {
      ground: false,
      first: false,
      second: false,
    };
    for (const v of views) {
      const open =
        v.review != null ||
        (v.risk_level !== "nominal" && v.detail?.derived_facts?.length);
      if (!open) continue;
      if (columnForView(v) === "closed") continue;
      const entryId = v.review?.id ?? `signal:${v.asset.id}`;
      if (!isNew(entryId)) continue;
      byAsset[v.asset.id] = true;
      byFloor[floorOfAsset(v.asset.id, v.asset.floor)] = true;
    }
    return { freshByAsset: byAsset, freshByFloor: byFloor };
  }, [views, isNew]);

  const selected = selectedAssetId
    ? findViewByAssetId(views, selectedAssetId)
    : null;

  const idx = floorIndex(activeFloor);
  const prevFloor = idx > 0 ? FLOOR_ORDER[idx - 1] : null;
  const nextFloor = idx < FLOOR_ORDER.length - 1 ? FLOOR_ORDER[idx + 1] : null;

  const floorSpatialLinks = useMemo(
    () => buildFloorSpatialLinks(activeFloor, views, MAP),
    [activeFloor, views],
  );

  const enterFloor = useCallback(
    (floor: PlantFloor, dir: SlideDir = "in") => {
      clearViewTransition();
      setOverviewExiting(false);
      setSlideDir(dir);
      startTransition(() => {
        setActiveFloor(floor);
        setViewMode("detail");
      });
      lastFocusedRef.current = null;
    },
    [clearViewTransition],
  );

  /** From the all-floors grid: zoom into the chosen floor. */
  const zoomIntoFloor = useCallback(
    (floor: PlantFloor) => {
      if (viewMode !== "overview" || overviewExiting) return;
      selectAsset(null);
      pendingFocusRef.current = null;
      setOverviewExiting(true);
      clearViewTransition();
      viewTransitionTimerRef.current = window.setTimeout(() => {
        viewTransitionTimerRef.current = null;
        enterFloor(floor, "in");
      }, VIEW_ZOOM_MS);
    },
    [viewMode, overviewExiting, selectAsset, clearViewTransition, enterFloor],
  );

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
    if (viewMode !== "detail" || slideDir === "out") return;
    lastFocusedRef.current = null;
    pendingFocusRef.current = null;
    selectAsset(null);
    setSlideDir("out");
    clearViewTransition();
    viewTransitionTimerRef.current = window.setTimeout(() => {
      viewTransitionTimerRef.current = null;
      setViewMode("overview");
      setOverviewExiting(false);
      setSlideDir("in");
    }, VIEW_ZOOM_MS);
  }, [viewMode, slideDir, selectAsset, clearViewTransition]);

  const goPrevFloor = useCallback(() => {
    if (!prevFloor) return;
    navigateFloor(prevFloor, "right");
  }, [prevFloor, navigateFloor]);

  const goNextFloor = useCallback(() => {
    if (!nextFloor) return;
    navigateFloor(nextFloor, "left");
  }, [nextFloor, navigateFloor]);

  useLayoutEffect(() => {
    const track = floorTablistRef.current;
    const tab = floorTabRefs.current[activeFloorTab];
    if (!track || !tab) return;

    const update = () => {
      setFloorSlider({
        left: tab.offsetLeft,
        width: tab.offsetWidth,
      });
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(track);
    ro.observe(tab);
    return () => ro.disconnect();
  }, [activeFloorTab]);

  // Fit the map after switching into detail or changing floors.
  useEffect(() => {
    if (viewMode !== "detail" || slideDir === "out") return;
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
  }, [viewMode, activeFloor, slideDir]);

  // Re-center after the affected-areas inset animates open/closed.
  useEffect(() => {
    if (viewMode !== "detail" || slideDir === "out") return;
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
  }, [sidebarOpen, viewMode, slideDir]);

  useEffect(() => {
    if (!selectedAssetId) {
      lastFocusedRef.current = null;
      return;
    }
    const entry = MAP[selectedAssetId];
    const floor = floorOfAsset(selectedAssetId, selected?.asset.floor);

    if (viewMode === "overview") {
      if (overviewExiting) return;
      pendingFocusRef.current = selectedAssetId;
      setOverviewExiting(true);
      clearViewTransition();
      viewTransitionTimerRef.current = window.setTimeout(() => {
        viewTransitionTimerRef.current = null;
        enterFloor(floor, "in");
      }, VIEW_ZOOM_MS);
      return;
    }

    if (floor !== activeFloor) {
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
    overviewExiting,
    selected?.asset.floor,
    enterFloor,
    clearViewTransition,
  ]);

  useEffect(() => {
    if (viewMode !== "detail" || slideDir === "out") return;
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
  }, [
    viewMode,
    slideDir,
    goPrevFloor,
    goNextFloor,
    showOverview,
    selectedAssetId,
    selectAsset,
  ]);

  const showMapControls = viewMode === "detail" && slideDir !== "out";

  return (
    <div
      className={styles.wrap}
      data-panel-resizing={sidebarResizing || drawerResizing ? "true" : undefined}
      style={
        {
          "--affected-panel-width": `${sidebarWidth}px`,
          "--drawer-width": `${effectiveDrawerWidth}px`,
        } as CSSProperties
      }
    >
      <div
        className={styles.stage}
        data-affected-inset={sidebarOpen ? "true" : undefined}
        data-resizing={sidebarResizing ? "true" : undefined}
      >
        {viewMode === "overview" ? (
          <FloorOverview
            riskByAsset={riskByAsset}
            activityByFloor={activityByFloor}
            freshByFloor={freshByFloor}
            exiting={overviewExiting}
            onSelectFloor={zoomIntoFloor}
          />
        ) : (
          <div
            className={styles.detailPane}
            data-exiting={slideDir === "out" ? "true" : undefined}
          >
            <MapViewport ref={mapRef}>
              <div
                key={activeFloor}
                className={styles.floorSlide}
                data-slide={slideDir}
              >
                <FloorPlan
                  floor={activeFloor}
                  riskByAsset={riskByAsset}
                  criticalByAsset={criticalByAsset}
                  resolvedByAsset={resolvedByAsset}
                  freshByAsset={freshByAsset}
                  selectedAssetId={selectedAssetId}
                  onSelectAsset={selectAsset}
                  spatialLinks={floorSpatialLinks}
                  opsChipsByAsset={opsChipsByAsset}
                  showOpsLayer={enabledLayers.has("ops")}
                />
              </div>
            </MapViewport>
          </div>
        )}

        {viewMode === "detail" && slideDir !== "out" ? (
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

        {showMapControls ? (
          <MapControls
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
            onReset={() => mapRef.current?.resetView()}
            onOverview={showOverview}
            opsEnabled={enabledLayers.has("ops")}
            onToggleOps={() => toggleLayer("ops")}
            opsCount={opsAssetCount}
            shiftForDrawer={Boolean(selected) && viewMode === "detail"}
          />
        ) : null}

        {selected && viewMode === "detail" && slideDir !== "out" ? (
          <AssetPanel
            view={selected}
            onClose={() => selectAsset(null)}
            width={effectiveDrawerWidth}
            minWidth={drawerMin}
            maxWidth={DRAWER_WIDTH_MAX}
            onWidthChange={setDrawerWidth}
            onResizingChange={setDrawerResizing}
          />
        ) : null}
      </div>

      <div
        ref={floorTablistRef}
        className={styles.floorTabs}
        role="tablist"
        aria-label="Plant floors"
      >
        <span
          className={styles.floorTabSlider}
          aria-hidden
          style={{
            transform: `translateX(${floorSlider.left}px)`,
            width: floorSlider.width,
          }}
        />
        <button
          ref={(el) => {
            floorTabRefs.current.all = el;
          }}
          type="button"
          role="tab"
          aria-selected={activeFloorTab === "all"}
          className={styles.floorTab}
          data-active={activeFloorTab === "all" ? "true" : undefined}
          onClick={() => {
            if (activeFloorTab === "all") return;
            showOverview();
          }}
        >
          <span className={styles.floorTabLabel}>All</span>
        </button>
        {FLOOR_ORDER.map((id) => {
          const selected = activeFloorTab === id;
          return (
            <button
              key={id}
              ref={(el) => {
                floorTabRefs.current[id] = el;
              }}
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
                if (viewMode === "overview") {
                  zoomIntoFloor(id);
                  return;
                }
                if (slideDir === "out") {
                  clearViewTransition();
                  enterFloor(id, "in");
                  return;
                }
                const from = floorIndex(activeFloor);
                const to = floorIndex(id);
                const dir: SlideDir = to > from ? "left" : "right";
                navigateFloor(id, dir);
              }}
            >
              <span className={styles.floorTabLabel}>{FLOOR_LABELS[id]}</span>
              {freshByFloor[id] ? (
                <span className={styles.floorFresh} aria-label="New data" title="New data" />
              ) : null}
              {activityByFloor[id] > 0 ? (
                <span className={styles.floorBadge}>{activityByFloor[id]}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <ReviewSidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        affectedCount={affectedCount}
        width={sidebarWidth}
        minWidth={SIDEBAR_WIDTH_MIN}
        maxWidth={SIDEBAR_WIDTH_MAX}
        onWidthChange={setSidebarWidth}
        onResizingChange={setSidebarResizing}
      />

    </div>
  );
}
