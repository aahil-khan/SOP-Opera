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
  assetName: string;
  spatialLinks?: SpatialLinkView[];
  /** When true, omit the outer section heading (used inside DomainDetailFlyout). */
  embedded?: boolean;
}

export function SpatialGraphPanel({
  assetId,
  assetName,
  spatialLinks = [],
  embedded = false,
}: SpatialGraphPanelProps) {
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (spatialLinks.length === 0 && neighbors.length === 0 && !error) {
    if (embedded) {
      return <p className={styles.muted}>No spatial links for this asset.</p>;
    }
    return null;
  }

  return (
    <section
      className={styles.section}
      aria-labelledby={embedded ? undefined : "kg-heading"}
      aria-label={embedded ? "Knowledge graph" : undefined}
    >
      {!embedded && (
        <h3 id="kg-heading" className={styles.title}>
          Knowledge graph
        </h3>
      )}
      {spatialLinks.length > 0 && (
        <div className={styles.block}>
          <p className={styles.label}>Spatial co-occurrence</p>
          <ul className={styles.list}>
            {spatialLinks.map((L) => (
              <li
                key={`${L.from_asset_id}-${L.to_asset_id}-${L.relation}`}
                className={styles.linkCard}
                data-alert="true"
              >
                <span className={styles.badge}>{L.relation}</span>
                <strong>
                  {L.from_label} ↔ {L.to_label}
                </strong>
                <span className={styles.meta}>
                  {L.distance_m.toFixed(1)}m
                  {L.floors_apart > 0 ? ` · ${L.floors_apart} floor apart` : ""}
                </span>
                {L.reason && <p className={styles.reason}>{L.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {neighbors.length > 0 && (
        <div className={styles.block}>
          <p className={styles.label}>NEAR / ABOVE {assetName}</p>
          <ul className={styles.chipRow}>
            {neighbors.slice(0, 8).map((n) => (
              <li key={n.asset_id} className={styles.chip}>
                {n.label ?? n.asset_id.slice(0, 8)} · {n.distance_m.toFixed(1)}m ·{" "}
                {n.relation}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className={styles.muted}>Graph: {error}</p>}
    </section>
  );
}
