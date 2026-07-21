"use client";

import { useEffect, useState } from "react";
import type { SpatialLinkView } from "@/lib/liveStore";
import { useLiveStore } from "@/lib/liveStore";
import { fetchGraphNeighbors } from "@/lib/graphNeighborsCache";
import {
  otherAssetIdInLink,
  otherLabelInLink,
  relationRelativeToFocus,
} from "@/lib/spatialRelation";
import type { PlantFloor } from "@/shared/enums";
import floorPlanMap from "@/lib/floor_plan_map.json";
import styles from "./SpatialGraphPanel.module.css";

const MAP = floorPlanMap as Record<
  string,
  { floor?: PlantFloor; label?: string }
>;

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

function focusFloor(assetId: string, fallback?: string): PlantFloor {
  const fromMap = MAP[assetId]?.floor;
  if (fromMap) return fromMap;
  if (fallback === "first" || fallback === "second") return fallback;
  return "ground";
}

export function SpatialGraphPanel({
  assetId,
  spatialLinks = [],
  embedded = false,
}: SpatialGraphPanelProps) {
  const openAssetDomain = useLiveStore((s) => s.openAssetDomain);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const viewerFloor = focusFloor(assetId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchGraphNeighbors(assetId)
      .then((result) => {
        if (!cancelled) {
          setNeighbors(result.neighbors);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setNeighbors([]);
          setError(e instanceof Error ? e.message : "graph unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const openLinkedAsset = (targetId: string) => {
    if (!targetId || targetId === assetId) return;
    openAssetDomain(targetId, "spatial");
  };

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
          {spatialLinks.map((L) => {
            const otherId = otherAssetIdInLink(assetId, L);
            const otherLabel = otherLabelInLink(assetId, L);
            const otherFl = focusFloor(otherId);
            const relation = relationRelativeToFocus(
              L.relation,
              viewerFloor,
              otherFl,
            );
            return (
              <li key={`${L.from_asset_id}-${L.to_asset_id}-${L.relation}`}>
                <button
                  type="button"
                  className={styles.card}
                  data-alert="true"
                  onClick={() => openLinkedAsset(otherId)}
                >
                  <div className={styles.cardHead}>
                    <span className={styles.badge} data-rel={relation}>
                      {relation}
                    </span>
                    <strong className={styles.name}>
                      {otherLabel} ↔ {MAP[assetId]?.label ?? assetId.slice(0, 8)}
                    </strong>
                  </div>
                  <p className={styles.meta}>
                    {L.distance_m.toFixed(1)}m
                    {L.floors_apart > 0
                      ? ` · ${L.floors_apart} floor${L.floors_apart === 1 ? "" : "s"} apart`
                      : ""}
                  </p>
                  {L.reason && <p className={styles.reason}>{L.reason}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {neighbors.length > 0 && (
        <ul className={styles.list}>
          {neighbors.map((n) => (
            <li key={n.asset_id}>
              <button
                type="button"
                className={styles.card}
                onClick={() => openLinkedAsset(n.asset_id)}
              >
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
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className={styles.muted}>Graph: {error}</p>}
    </section>
  );
}
