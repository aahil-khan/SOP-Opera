"use client";

import { useEffect, useRef, useState } from "react";
import {
  findViewByAssetId,
  getLiveAssetViews,
  useLiveStore,
} from "@/lib/liveStore";
import floorPlanMap from "@/lib/floor_plan_map.json";
import type { RiskLevel } from "@/shared/enums";
import { FloorPlan } from "./FloorPlan";
import { AssetPanel } from "./AssetPanel";
import { ReviewSidebar } from "./ReviewSidebar";
import { MapControls } from "./MapControls";
import { MapViewport, type MapViewportHandle } from "./MapViewport";
import styles from "./DigitalTwin.module.css";

type FloorEntry = {
  x: number;
  y: number;
  hit?: { x: number; y: number; w: number; h: number };
};

const MAP = floorPlanMap as Record<string, FloorEntry>;

export function DigitalTwin() {
  const assets = useLiveStore((s) => s.assets);
  const reviews = useLiveStore((s) => s.reviews);
  const reviewDetails = useLiveStore((s) => s.reviewDetails);
  const assessmentsByReview = useLiveStore((s) => s.assessmentsByReview);
  const selectedAssetId = useLiveStore((s) => s.selectedAssetId);
  const selectAsset = useLiveStore((s) => s.selectAsset);
  const loading = useLiveStore((s) => s.loading);
  const error = useLiveStore((s) => s.error);
  const bootstrapped = useLiveStore((s) => s.bootstrapped);

  const mapRef = useRef<MapViewportHandle>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const lastFocusedRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!selectedAssetId) {
      lastFocusedRef.current = null;
      return;
    }
    if (lastFocusedRef.current === selectedAssetId) return;
    const entry = MAP[selectedAssetId];
    if (!entry) return;
    lastFocusedRef.current = selectedAssetId;
    mapRef.current?.focusOn(
      { x: entry.x, y: entry.y },
      entry.hit ? { bounds: entry.hit } : undefined,
    );
  }, [selectedAssetId]);

  return (
    <div className={styles.wrap}>
      <div className={styles.stage}>
        <MapViewport ref={mapRef}>
          <FloorPlan
            riskByAsset={riskByAsset}
            selectedAssetId={selectedAssetId}
            onSelectAsset={selectAsset}
          />
        </MapViewport>

        <div className={styles.legend} aria-hidden={false}>
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
          <span className={styles.scenarioTag}>
            <span
              className={styles.liveDot}
              data-live={!(loading && !bootstrapped)}
            />
            {loading && !bootstrapped
              ? "Connecting…"
              : error
                ? `Live · ${error}`
                : "Live"}
          </span>
        </div>

        <MapControls
          onZoomIn={() => mapRef.current?.zoomIn()}
          onZoomOut={() => mapRef.current?.zoomOut()}
          onReset={() => mapRef.current?.resetView()}
          shiftForDrawer={Boolean(selected)}
        />

        {selected && (
          <AssetPanel view={selected} onClose={() => selectAsset(null)} />
        )}
      </div>

      <ReviewSidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        affectedCount={affectedCount}
      />
    </div>
  );
}
