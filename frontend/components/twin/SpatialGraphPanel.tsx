"use client";

import { useEffect, useState } from "react";
import type { SpatialLinkView } from "@/lib/liveStore";
import { API_BASE } from "@/lib/api";
import styles from "./SpatialGraphPanel.module.css";

interface Neighbor {
  asset_id: string;
  label?: string;
  zone?: string;
  floor?: string;
  relation: string;
  distance_m: number;
  floors_apart: number;
}

interface SpatialGraphPanelProps {
  assetId: string;
  assetName?: string;
  spatialLinks?: SpatialLinkView[];
  /** When true, omit the outer section heading (used inside DomainDetailFlyout). */
  embedded?: boolean;
}

export function SpatialGraphPanel({
  assetId,
  spatialLinks = [],
  embedded = false,
}: SpatialGraphPanelProps) {
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/graph/neighbors/${assetId}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { neighbors?: Neighbor[] };
        if (!cancelled) {
          setNeighbors(data.neighbors ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setNeighbors([]);
          setError(e instanceof Error ? e.message : "graph unavailable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (loading && spatialLinks.length === 0) {
    return <p className={styles.muted}>Loading nearby assets…</p>;
  }

  if (spatialLinks.length === 0 && neighbors.length === 0 && !error) {
    if (embedded) {
      return <p className={styles.muted}>No nearby assets for this location.</p>;
    }
    return null;
  }

  return (
    <section
      className={styles.section}
      aria-labelledby={embedded ? undefined : "kg-heading"}
      aria-label={embedded ? "Nearby assets" : undefined}
    >
      {!embedded && (
        <h3 id="kg-heading" className={styles.title}>
          Nearby assets
        </h3>
      )}

      {spatialLinks.length > 0 && (
        <ul className={styles.list}>
          {spatialLinks.map((L) => (
            <li
              key={`${L.from_asset_id}-${L.to_asset_id}-${L.relation}`}
              className={styles.card}
              data-alert="true"
            >
              <div className={styles.cardHead}>
                <span className={styles.badge} data-rel={L.relation}>
                  {L.relation}
                </span>
                <strong className={styles.name}>
                  {L.from_label} ↔ {L.to_label}
                </strong>
              </div>
              <p className={styles.meta}>
                {L.distance_m.toFixed(1)}m
                {L.floors_apart > 0
                  ? ` · ${L.floors_apart} floor${L.floors_apart === 1 ? "" : "s"} apart`
                  : ""}
              </p>
              {L.reason && <p className={styles.reason}>{L.reason}</p>}
            </li>
          ))}
        </ul>
      )}

      {neighbors.length > 0 && (
        <ul className={styles.list}>
          {neighbors.map((n) => (
            <li key={n.asset_id} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.badge} data-rel={n.relation}>
                  {n.relation}
                </span>
                <strong className={styles.name}>
                  {n.label ?? n.asset_id.slice(0, 8)}
                </strong>
              </div>
              <p className={styles.meta}>
                {n.distance_m.toFixed(1)}m
                {n.zone ? ` · ${n.zone}` : ""}
                {n.floor ? ` · ${n.floor}` : ""}
                {n.floors_apart > 0
                  ? ` · ${n.floors_apart} floor${n.floors_apart === 1 ? "" : "s"} apart`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {error && <p className={styles.muted}>Graph: {error}</p>}
    </section>
  );
}
