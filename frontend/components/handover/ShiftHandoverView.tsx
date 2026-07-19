"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchShiftHandover,
  type ShiftHandoverBrief,
  type ShiftHandoverOpenReview,
} from "@/lib/liveApi";
import styles from "./ShiftHandoverView.module.css";

function normalizeOpenReviews(
  items: ShiftHandoverBrief["open_reviews"],
): ShiftHandoverOpenReview[] {
  return items.map((item, i) => {
    if (typeof item === "string") {
      return {
        review_id: `legacy-${i}`,
        asset_id: "",
        asset_name: item,
        state: "",
        risk_level: "n/a",
        label: item,
      };
    }
    return item;
  });
}

export interface HandoverBriefPanelProps {
  hours?: number;
  autoFetch?: boolean;
  compact?: boolean;
  onSelectAsset?: (assetId: string) => void;
  onReady?: (brief: ShiftHandoverBrief) => void;
  showControls?: boolean;
}

export function HandoverBriefPanel({
  hours: initialHours = 12,
  autoFetch = true,
  compact = false,
  onSelectAsset,
  onReady,
  showControls = true,
}: HandoverBriefPanelProps) {
  const [brief, setBrief] = useState<ShiftHandoverBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(initialHours);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchShiftHandover(hours);
      setBrief(data);
      onReady?.(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hours, onReady]);

  useEffect(() => {
    if (!autoFetch) return;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / hours only via manual regen
  }, [autoFetch]);

  const openReviews = brief ? normalizeOpenReviews(brief.open_reviews) : [];

  return (
    <div className={compact ? styles.compact : styles.wrap}>
      {showControls && (
        <header className={styles.header}>
          <div>
            <p className={styles.aiMark}>Agentic</p>
            <h1 className={styles.title}>Shift Handover Brief</h1>
            <p className={styles.meta}>
              Generative safety brief from the last N hours of plant signals,
              derived facts, and open reviews.
            </p>
          </div>
          <div className={styles.controls}>
            <label className={styles.label}>
              Window (hours)
              <input
                className={styles.input}
                type="number"
                min={1}
                max={72}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value) || 12)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void generate()}
              disabled={loading}
            >
              {loading ? "Generating…" : brief ? "Regenerate" : "Generate brief"}
            </button>
          </div>
        </header>
      )}

      {!showControls && loading && (
        <p className={styles.loadingLine}>Generating overnight brief…</p>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {brief && (
        <article className={styles.card}>
          <div className={styles.cardMeta}>
            <span>{brief.provider}</span>
            <span>{brief.model}</span>
            <span>{brief.signal_count} signals</span>
            <span>{brief.window_hours}h window</span>
          </div>
          <pre className={styles.brief}>{brief.brief}</pre>

          {openReviews.length > 0 && (
            <div className={styles.openWork}>
              <h2>Open work</h2>
              <ul className={styles.openWorkList}>
                {openReviews.map((r) => {
                  const clickable = Boolean(r.asset_id && onSelectAsset);
                  return (
                    <li key={r.review_id}>
                      {clickable ? (
                        <button
                          type="button"
                          className={styles.openWorkItem}
                          onClick={() => onSelectAsset?.(r.asset_id)}
                        >
                          <span className={styles.openWorkName}>
                            {r.asset_name}
                          </span>
                          <span className={styles.openWorkMeta}>
                            {r.state.replaceAll("_", " ")}
                            {r.risk_level && r.risk_level !== "n/a"
                              ? ` · ${r.risk_level}`
                              : ""}
                          </span>
                        </button>
                      ) : (
                        <span className={styles.openWorkItemStatic}>
                          {r.label ?? r.asset_name}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {brief.active_facts.length > 0 && (
            <div className={styles.facts}>
              <h2>Active facts</h2>
              <ul>
                {brief.active_facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}
    </div>
  );
}

export function ShiftHandoverView() {
  return <HandoverBriefPanel autoFetch showControls />;
}
