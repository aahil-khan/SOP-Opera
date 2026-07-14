"use client";

import {
  findViewByAssetId,
  getLiveAssetViews,
  useLiveStore,
} from "@/lib/liveStore";
import type { RiskLevel } from "@/shared/enums";
import { FloorPlan } from "./FloorPlan";
import { AssetPanel } from "./AssetPanel";
import { ReviewSidebar } from "./ReviewSidebar";
import styles from "./DigitalTwin.module.css";

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

  return (
    <div className={styles.wrap}>
      <aside className={styles.left}>
        <ReviewSidebar />
      </aside>

      <div className={styles.center}>
        <div className={styles.legend}>
          <span>
            <span
              className={styles.swatch}
              style={{ background: "var(--risk-nominal)" }}
            />
            Nominal
          </span>
          <span>
            <span
              className={styles.swatch}
              style={{ background: "var(--risk-elevated)" }}
            />
            Elevated
          </span>
          <span>
            <span
              className={styles.swatch}
              style={{ background: "var(--risk-blocking)" }}
            />
            Blocking
          </span>
          <span className={styles.scenarioTag}>
            {loading && !bootstrapped
              ? "Connecting…"
              : error
                ? `Live · ${error}`
                : "Live · backend"}
          </span>
        </div>

        <div className={styles.stage}>
          <FloorPlan
            riskByAsset={riskByAsset}
            selectedAssetId={selectedAssetId}
            onSelectAsset={selectAsset}
          />
          {selected && (
            <AssetPanel
              view={selected}
              onClose={() => selectAsset(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
