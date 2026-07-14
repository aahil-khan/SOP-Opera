"use client";

import Link from "next/link";
import {
  getReviewsFromRuntimes,
  useDemoStore,
} from "@/lib/demoStore";
import styles from "./ReviewList.module.css";

export function ReviewList() {
  const runtimes = useDemoStore((s) => s.runtimes);
  const reviews = getReviewsFromRuntimes(runtimes);

  return (
    <div className={styles.list}>
      <header className={styles.header}>
        <h1 className={styles.title}>Operational Reviews</h1>
        <p className={styles.subtitle}>
          Secondary navigation — Digital Twin remains the primary landing view.
        </p>
      </header>

      {reviews.length === 0 ? (
        <p className={styles.empty}>
          No active reviews. Start a scenario from the Demo Mode bar.
        </p>
      ) : (
        reviews.map((rt) => {
          const review = rt.review!;
          return (
            <Link
              key={review.id}
              href={`/reviews/${review.id}`}
              className={styles.item}
            >
              <div className={styles.itemMeta}>
                <span className={styles.itemName}>{rt.asset.name}</span>
                <span className={styles.itemZone}>
                  {rt.asset.zone} · triggered by {review.triggered_by}
                </span>
              </div>
              <div className={styles.itemBadges}>
                <span className="badge">{review.state.replaceAll("_", " ")}</span>
                <span className="badge" data-risk={rt.risk_level}>
                  {rt.risk_level}
                </span>
              </div>
            </Link>
          );
        })
      )}
    </div>
  );
}
