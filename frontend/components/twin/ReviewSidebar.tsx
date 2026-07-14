"use client";

import {
  getLiveAssetViews,
  useLiveStore,
} from "@/lib/liveStore";
import styles from "./ReviewSidebar.module.css";

export function ReviewSidebar() {
  const assets = useLiveStore((s) => s.assets);
  const reviews = useLiveStore((s) => s.reviews);
  const reviewDetails = useLiveStore((s) => s.reviewDetails);
  const assessmentsByReview = useLiveStore((s) => s.assessmentsByReview);
  const selectedAssetId = useLiveStore((s) => s.selectedAssetId);
  const selectAsset = useLiveStore((s) => s.selectAsset);

  const views = getLiveAssetViews({
    assets,
    reviews,
    reviewDetails,
    assessmentsByReview,
  }).filter(
    (v) =>
      v.review != null ||
      (v.risk_level !== "nominal" && v.detail?.derived_facts?.length),
  );

  return (
    <aside className={styles.sidebar} aria-label="Affected areas">
      <header className={styles.header}>
        <h2 className={styles.title}>Affected areas</h2>
        <p className={styles.subtitle}>Select to locate on the twin</p>
      </header>

      {views.length === 0 ? (
        <p className={styles.empty}>
          No active signals. Ingest context or start a simulator scenario.
        </p>
      ) : (
        <ul className={styles.list}>
          {views.map((v) => {
            const active = selectedAssetId === v.asset.id;
            return (
              <li key={v.review?.id ?? v.asset.id}>
                <button
                  type="button"
                  className={styles.item}
                  data-active={active}
                  data-risk={v.risk_level}
                  onClick={() => selectAsset(v.asset.id)}
                >
                  <span className={styles.itemTop}>
                    <span className={styles.itemName}>{v.asset.name}</span>
                    <span className="badge" data-risk={v.risk_level}>
                      {v.risk_level}
                    </span>
                  </span>
                  <span className={styles.itemMeta}>
                    {v.asset.zone} ·{" "}
                    {v.review
                      ? v.review.state.replaceAll("_", " ")
                      : "signal"}
                  </span>
                  <span className={styles.itemTrigger}>
                    {v.review?.triggered_by ?? "live context"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
