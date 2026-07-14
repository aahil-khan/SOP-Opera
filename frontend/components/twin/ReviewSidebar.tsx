"use client";

import {
  getReviewsFromRuntimes,
  useDemoStore,
} from "@/lib/demoStore";
import styles from "./ReviewSidebar.module.css";

export function ReviewSidebar() {
  const runtimes = useDemoStore((s) => s.runtimes);
  const selectedAssetId = useDemoStore((s) => s.selectedAssetId);
  const selectAsset = useDemoStore((s) => s.selectAsset);
  const reviews = getReviewsFromRuntimes(runtimes);

  // Also surface elevated/blocking assets that don't yet have a review (mid-scenario).
  const affectedWithoutReview = Object.values(runtimes).filter(
    (rt) =>
      rt.risk_level !== "nominal" &&
      !rt.review &&
      !reviews.some((r) => r.asset.id === rt.asset.id),
  );

  const items = [
    ...reviews.map((rt) => ({
      key: rt.review!.id,
      assetId: rt.asset.id,
      name: rt.asset.name,
      zone: rt.asset.zone,
      risk: rt.risk_level,
      state: rt.review!.state.replaceAll("_", " "),
      trigger: rt.review!.triggered_by,
    })),
    ...affectedWithoutReview.map((rt) => ({
      key: `alert-${rt.asset.id}`,
      assetId: rt.asset.id,
      name: rt.asset.name,
      zone: rt.asset.zone,
      risk: rt.risk_level,
      state: "signal",
      trigger: "live context",
    })),
  ];

  return (
    <aside className={styles.sidebar} aria-label="Affected areas">
      <header className={styles.header}>
        <h2 className={styles.title}>Affected areas</h2>
        <p className={styles.subtitle}>
          Select to locate on the twin
        </p>
      </header>

      {items.length === 0 ? (
        <p className={styles.empty}>
          No active signals. Start a scenario from Demo Mode.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => {
            const active = selectedAssetId === item.assetId;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className={styles.item}
                  data-active={active}
                  data-risk={item.risk}
                  onClick={() => selectAsset(item.assetId)}
                >
                  <span className={styles.itemTop}>
                    <span className={styles.itemName}>{item.name}</span>
                    <span className="badge" data-risk={item.risk}>
                      {item.risk}
                    </span>
                  </span>
                  <span className={styles.itemMeta}>
                    {item.zone} · {item.state}
                  </span>
                  <span className={styles.itemTrigger}>{item.trigger}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
