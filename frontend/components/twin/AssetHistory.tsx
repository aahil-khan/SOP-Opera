"use client";

import { useEffect, useState } from "react";
import {
  fetchReports,
  type ReportSummary,
} from "@/lib/liveApi";
import { formatDate } from "@/lib/humanize";
import { useLiveStore } from "@/lib/liveStore";
import styles from "./AssetHistory.module.css";

function outcomeRisk(outcome: string | null): string {
  if (outcome === "blocked") return "blocking";
  if (outcome === "approved_with_conditions") return "elevated";
  if (outcome === "approved") return "nominal";
  return "halted";
}

interface AssetHistoryProps {
  assetId: string;
  /** Review currently shown in the panel — highlights the matching history row. */
  activeReviewId?: string | null;
}

export function AssetHistory({ assetId, activeReviewId = null }: AssetHistoryProps) {
  const openAssetClosure = useLiveStore((s) => s.openAssetClosure);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReports(null);
    setFailed(false);
    void fetchReports({ asset_id: assetId, limit: 20 })
      .then((rows) => {
        if (!cancelled) setReports(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return (
    <section className={styles.root} aria-labelledby="asset-history-heading">
      <h3 id="asset-history-heading" className={styles.title}>
        History
      </h3>
      {failed ? (
        <p className={styles.empty}>Could not load prior issues.</p>
      ) : reports == null ? (
        <p className={styles.empty}>Loading…</p>
      ) : reports.length === 0 ? (
        <p className={styles.empty}>No prior issues on file.</p>
      ) : (
        <ul className={styles.list}>
          {reports.map((r) => {
            const label =
              r.outcome_label ??
              (r.outcome ? r.outcome.replaceAll("_", " ") : null);
            const line =
              r.summary_line ?? r.outcome_headline ?? r.title ?? "Closure report";
            const active = activeReviewId === r.review_id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.row}
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "true" : undefined}
                  onClick={() => openAssetClosure(assetId, r.review_id)}
                >
                  <span className={styles.meta}>
                    <time dateTime={r.frozen_at ?? r.generated_at}>
                      {formatDate(r.frozen_at ?? r.generated_at)}
                    </time>
                    {label ? (
                      <span
                        className="badge"
                        data-risk={outcomeRisk(r.outcome)}
                      >
                        {label}
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.summary}>{line}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
