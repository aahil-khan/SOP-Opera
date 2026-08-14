"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  useLiveAssetViews,
  useLiveStore,
  type TelemetryMetricKey,
  type TelemetrySample,
  type TelemetryStatusChip,
} from "@/lib/liveStore";
import { isBlockedWork, isElevatedOrBlocking } from "@/lib/openWork";
import { relativeTime } from "@/lib/relativeTime";
import { useNewEntries } from "@/lib/useNewEntries";
import type { Asset } from "@/shared/schemas";
import type { PlantFloor } from "@/shared/enums";
import floorPlanMap from "@/lib/floor_plan_map.json";
import { FLOOR_LABELS, FLOOR_ORDER } from "./floorPlanShared";
import styles from "./OverviewPanel.module.css";

// ── Constants ──────────────────────────────────────────────────────────────

const SOURCES = [
  { id: "scada", label: "SCADA", mark: "Sensors" },
  { id: "ptw", label: "Permit to Work", mark: "Permits" },
  { id: "maintenance", label: "Maintenance", mark: "Isolation" },
  { id: "workforce", label: "Workforce", mark: "People" },
] as const;

type FeedSourceId = (typeof SOURCES)[number]["id"];

const ORIGIN_BY_SOURCE: Record<FeedSourceId, string> = {
  scada: "0% 0%",
  ptw: "100% 0%",
  maintenance: "0% 100%",
  workforce: "100% 100%",
};

const METRIC_META: Record<TelemetryMetricKey, { label: string; unit: string; warnAt?: number }> = {
  gas_reading:   { label: "Gas",           unit: "ppm",  warnAt: 20 },
  temp_reading:  { label: "Temp",          unit: "°C",   warnAt: 80 },
  vibration_mm_s:{ label: "Vibration",     unit: "mm/s", warnAt: 7.1 },
  level_pct:     { label: "Level",         unit: "%" },
  ph:            { label: "pH",            unit: "" },
  wind_ms:       { label: "Wind",          unit: "m/s",  warnAt: 15 },
};

type FloorEntry = { floor?: PlantFloor };

const MAP = floorPlanMap as Record<string, FloorEntry>;

function floorOfAsset(assetId: string, assets: Asset[]): PlantFloor {
  const mapped = MAP[assetId]?.floor;
  if (mapped) return mapped;
  const asset = assets.find((a) => a.id === assetId);
  if (asset?.floor === "first" || asset?.floor === "second" || asset?.floor === "ground") {
    return asset.floor;
  }
  return "ground";
}

function getScadaAssets(bySource: Record<string, TelemetrySample>): TelemetrySample[] {
  const seen = new Map<string, TelemetrySample>();
  for (const [key, sample] of Object.entries(bySource)) {
    if (!key.startsWith("scada:") || key === "scada") continue;
    if (!seen.has(sample.asset_id)) seen.set(sample.asset_id, sample);
  }
  return Array.from(seen.values()).sort((a, b) => a.asset_id.localeCompare(b.asset_id));
}

function metricsForAsset(sample: TelemetrySample) {
  return (Object.keys(METRIC_META) as TelemetryMetricKey[])
    .filter((k) => typeof sample.payload[k] === "number")
    .map((k) => {
      const val = sample.payload[k] as number;
      const meta = METRIC_META[k];
      const elevated = meta.warnAt != null && val >= meta.warnAt;
      return {
        key: k,
        label: meta.label,
        value: val.toFixed(k === "vibration_mm_s" ? 2 : 1),
        unit: meta.unit,
        risk: elevated ? "elevated" : "nominal",
      };
    });
}

function assetLabel(
  assetId: string,
  assets: Asset[],
  fallback?: string | null,
): string {
  return fallback ?? assets.find((a) => a.id === assetId)?.name ?? assetId;
}

function assetZone(assetId: string, assets: Asset[]): string | null {
  return assets.find((a) => a.id === assetId)?.zone ?? null;
}

function rowRisk(chip: TelemetryStatusChip): "elevated" | "nominal" {
  const label = chip.label.toLowerCase();
  if (label.includes("incomplete") || label.includes("hazardous") || label.includes("missing")) {
    return "elevated";
  }
  if (chip.category === "permit" && label.includes("active")) return "elevated";
  if (chip.category === "isolation_status" && label.includes("incomplete")) return "elevated";
  return "nominal";
}

function statusForSource(
  source: FeedSourceId,
  telemetryStatus: TelemetryStatusChip[],
): TelemetryStatusChip[] {
  if (source === "ptw") return telemetryStatus.filter((s) => s.category === "permit");
  if (source === "maintenance") {
    return telemetryStatus.filter((s) => s.category === "isolation_status");
  }
  if (source === "workforce") {
    return telemetryStatus.filter(
      (s) => s.category === "worker_location" || s.category === "ppe_status",
    );
  }
  return [];
}

function sortByTsDesc<T extends { ts?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.ts ?? "") - Date.parse(a.ts ?? ""));
}

function statusEntryKey(chip: TelemetryStatusChip): string {
  return `${chip.category}:${chip.asset_id}`;
}

function scadaEntryKey(assetId: string): string {
  return `scada:${assetId}`;
}

function groupByFloor<T>(
  items: T[],
  getAssetId: (item: T) => string,
  assets: Asset[],
): Record<PlantFloor, T[]> {
  const groups: Record<PlantFloor, T[]> = { ground: [], first: [], second: [] };
  for (const item of items) {
    groups[floorOfAsset(getAssetId(item), assets)].push(item);
  }
  return groups;
}

// ── Feed overlay (telemetry subscriptions only while open) ─────────────────

type OverviewFeedOverlayProps = {
  kpiGrid: ReactNode;
  overlayClosing: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
  onGoToAsset: (assetId: string) => void;
};

function OverviewFeedOverlay({
  kpiGrid,
  overlayClosing,
  onRequestClose,
  onClosed,
  onGoToAsset,
}: OverviewFeedOverlayProps) {
  const assets = useLiveStore((s) => s.assets);
  const telemetryStatus = useLiveStore((s) => s.telemetryStatus);
  const bySource = useLiveStore((s) => s.telemetryBySource);

  const [expandedSource, setExpandedSource] = useState<FeedSourceId | null>(null);
  const [paneClosing, setPaneClosing] = useState(false);
  const paneSourceRef = useRef<FeedSourceId | null>(null);

  useEffect(() => {
    if (expandedSource) paneSourceRef.current = expandedSource;
  }, [expandedSource]);

  const visiblePaneSource = expandedSource ?? (paneClosing ? paneSourceRef.current : null);

  const scadaAssets = useMemo(
    () => sortByTsDesc(getScadaAssets(bySource)),
    [bySource],
  );

  const ptwRows = useMemo(
    () => sortByTsDesc(statusForSource("ptw", telemetryStatus)),
    [telemetryStatus],
  );
  const maintRows = useMemo(
    () => sortByTsDesc(statusForSource("maintenance", telemetryStatus)),
    [telemetryStatus],
  );
  const workforceRows = useMemo(
    () => sortByTsDesc(statusForSource("workforce", telemetryStatus)),
    [telemetryStatus],
  );

  const feedEntryIds = useMemo(() => {
    const ids = scadaAssets.map((a) => scadaEntryKey(a.asset_id));
    for (const row of [...ptwRows, ...maintRows, ...workforceRows]) {
      ids.push(statusEntryKey(row));
    }
    return ids;
  }, [scadaAssets, ptwRows, maintRows, workforceRows]);

  const { isNew, now } = useNewEntries(feedEntryIds);

  const categoryCards = useMemo(() => {
    const scadaElevated = scadaAssets.filter((a) =>
      metricsForAsset(a).some((m) => m.risk === "elevated"),
    ).length;
    const ptwActive = ptwRows.filter((s) => s.label.toLowerCase().includes("active")).length;
    const maintIncomplete = maintRows.filter((s) =>
      s.label.toLowerCase().includes("incomplete"),
    ).length;
    const workforceRisk = workforceRows.filter((s) =>
      s.label.toLowerCase().includes("hazardous") || s.label.toLowerCase().includes("missing"),
    ).length;

    return [
      {
        id: "scada" as const,
        entryIds: scadaAssets.map((a) => scadaEntryKey(a.asset_id)),
        primary: String(scadaAssets.length),
        primaryLabel: "assets reporting",
        secondary: scadaElevated > 0 ? `${scadaElevated} elevated` : "All nominal",
        warn: scadaElevated > 0,
        preview: scadaAssets.slice(0, 3).map((a) => {
          const metrics = metricsForAsset(a);
          return {
            key: scadaEntryKey(a.asset_id),
            title: assetLabel(a.asset_id, assets, a.asset_name),
            detail: metrics.slice(0, 2).map((m) => `${m.label} ${m.value}${m.unit}`).join(" · ") || "No readings",
            risk: metrics.some((m) => m.risk === "elevated") ? "elevated" : "nominal",
            ts: a.ts,
          };
        }),
      },
      {
        id: "ptw" as const,
        entryIds: ptwRows.map(statusEntryKey),
        primary: String(ptwActive),
        primaryLabel: "active permits",
        secondary: `${ptwRows.length} total`,
        warn: ptwActive > 0,
        preview: ptwRows.slice(0, 3).map((c) => ({
          key: statusEntryKey(c),
          title: assetLabel(c.asset_id, assets),
          detail: c.label,
          risk: rowRisk(c),
          ts: c.ts,
        })),
      },
      {
        id: "maintenance" as const,
        entryIds: maintRows.map(statusEntryKey),
        primary: String(maintIncomplete),
        primaryLabel: "incomplete isolations",
        secondary: `${maintRows.length} total`,
        warn: maintIncomplete > 0,
        preview: maintRows.slice(0, 3).map((c) => ({
          key: statusEntryKey(c),
          title: assetLabel(c.asset_id, assets),
          detail: c.label,
          risk: rowRisk(c),
          ts: c.ts,
        })),
      },
      {
        id: "workforce" as const,
        entryIds: workforceRows.map(statusEntryKey),
        primary: String(workforceRisk),
        primaryLabel: "at risk / non-compliant",
        secondary: `${workforceRows.length} total`,
        warn: workforceRisk > 0,
        preview: workforceRows.slice(0, 3).map((c) => ({
          key: statusEntryKey(c),
          title: assetLabel(c.asset_id, assets),
          detail: c.label,
          risk: rowRisk(c),
          ts: c.ts,
        })),
      },
    ];
  }, [scadaAssets, ptwRows, maintRows, workforceRows, assets]);

  const sampleCount = Object.keys(bySource).length;

  const collapsePane = useCallback(() => {
    if (!expandedSource || paneClosing) return;
    setPaneClosing(true);
    setExpandedSource(null);
  }, [expandedSource, paneClosing]);

  const goToAsset = useCallback(
    (assetId: string) => {
      setPaneClosing(false);
      setExpandedSource(null);
      onGoToAsset(assetId);
    },
    [onGoToAsset],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (expandedSource || paneClosing) {
        collapsePane();
      } else {
        onRequestClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [expandedSource, paneClosing, collapsePane, onRequestClose]);

  const expandedMeta = visiblePaneSource
    ? SOURCES.find((s) => s.id === visiblePaneSource)
    : null;

  const scadaByFloor = useMemo(
    () => groupByFloor(scadaAssets, (a) => a.asset_id, assets),
    [scadaAssets, assets],
  );

  const statusByFloor = useMemo(() => {
    if (!visiblePaneSource || visiblePaneSource === "scada") {
      return { ground: [], first: [], second: [] } as Record<PlantFloor, TelemetryStatusChip[]>;
    }
    const rows =
      visiblePaneSource === "ptw"
        ? ptwRows
        : visiblePaneSource === "maintenance"
          ? maintRows
          : workforceRows;
    return groupByFloor(rows, (c) => c.asset_id, assets);
  }, [visiblePaneSource, ptwRows, maintRows, workforceRows, assets]);

  const floorBoard = visiblePaneSource === "scada" ? (
    <div className={styles.floorBoard}>
      {FLOOR_ORDER.map((floor) => {
        const items = scadaByFloor[floor];
        return (
          <section key={floor} className={styles.floorCol} aria-label={`${FLOOR_LABELS[floor]} floor`}>
            <header className={styles.floorColHead}>
              <span className={styles.floorColTitle}>{FLOOR_LABELS[floor]}</span>
              <span className={styles.floorColCount}>{items.length}</span>
            </header>
            {items.length === 0 ? (
              <p className={styles.floorEmpty}>No assets</p>
            ) : (
              <div className={styles.floorTiles}>
                {items.map((asset) => {
                  const metrics = metricsForAsset(asset);
                  const elevated = metrics.some((m) => m.risk === "elevated");
                  const zone = assetZone(asset.asset_id, assets);
                  const entryId = scadaEntryKey(asset.asset_id);
                  const fresh = isNew(entryId);
                  return (
                    <button
                      key={asset.asset_id}
                      type="button"
                      className={fresh ? `${styles.tile} ${styles.enter}` : styles.tile}
                      data-risk={elevated ? "elevated" : undefined}
                      onClick={() => goToAsset(asset.asset_id)}
                      title={`Go to ${asset.asset_name ?? asset.asset_id}`}
                    >
                      <span className={styles.tileHead}>
                        <span className={styles.tileName}>
                          {fresh ? <span className={styles.dot} aria-label="New" /> : null}
                          {assetLabel(asset.asset_id, assets, asset.asset_name)}
                        </span>
                      </span>
                      {zone ? <span className={styles.tileZone}>{zone}</span> : null}
                      {asset.ts ? (
                        <span className={styles.tileWhen}>{relativeTime(asset.ts, now)}</span>
                      ) : null}
                      {metrics.length === 0 ? (
                        <span className={styles.tileMuted}>No readings</span>
                      ) : (
                        <div className={styles.tileMetrics}>
                          {metrics.map((c) => (
                            <span key={c.key} className={styles.tileMetric} data-risk={c.risk}>
                              <span className={styles.tileMetricLabel}>{c.label}</span>
                              <span className={styles.tileMetricValue}>
                                {c.value}
                                {c.unit ? <span className={styles.unit}>{c.unit}</span> : null}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  ) : (
    <div className={styles.floorBoard}>
      {FLOOR_ORDER.map((floor) => {
        const items = statusByFloor[floor];
        return (
          <section key={floor} className={styles.floorCol} aria-label={`${FLOOR_LABELS[floor]} floor`}>
            <header className={styles.floorColHead}>
              <span className={styles.floorColTitle}>{FLOOR_LABELS[floor]}</span>
              <span className={styles.floorColCount}>{items.length}</span>
            </header>
            {items.length === 0 ? (
              <p className={styles.floorEmpty}>None on this floor</p>
            ) : (
              <div className={styles.floorTiles}>
                {items.map((chip) => {
                  const zone = assetZone(chip.asset_id, assets);
                  const entryId = statusEntryKey(chip);
                  const fresh = isNew(entryId);
                  return (
                    <button
                      key={`${chip.asset_id}-${chip.category}-${chip.ts}`}
                      type="button"
                      className={fresh ? `${styles.tile} ${styles.enter}` : styles.tile}
                      data-risk={rowRisk(chip)}
                      onClick={() => goToAsset(chip.asset_id)}
                      title={`Go to ${assetLabel(chip.asset_id, assets)}`}
                    >
                      <span className={styles.tileHead}>
                        <span className={styles.tileName}>
                          {fresh ? <span className={styles.dot} aria-label="New" /> : null}
                          {assetLabel(chip.asset_id, assets)}
                        </span>
                      </span>
                      {zone ? <span className={styles.tileZone}>{zone}</span> : null}
                      <span className={styles.tileWhen}>{relativeTime(chip.ts, now)}</span>
                      <span className={styles.tileStatus}>{chip.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );

  const allCategoriesGrid = (
    <div className={styles.categoryGrid} data-dimmed={visiblePaneSource ? "true" : undefined}>
      {categoryCards.map((card) => {
        const meta = SOURCES.find((s) => s.id === card.id)!;
        const cardFresh = card.entryIds.some(isNew);
        return (
          <section
            key={card.id}
            className={styles.categoryCard}
            data-tone={card.warn ? "warn" : undefined}
            data-active={visiblePaneSource === card.id ? "true" : undefined}
          >
            <header className={styles.categoryHead}>
              <div className={styles.categoryTitles}>
                <span className={styles.categoryMark}>{meta.mark}</span>
                <h3 className={styles.categoryTitle}>
                  {cardFresh ? <span className={styles.dot} aria-hidden="true" /> : null}
                  {meta.label}
                </h3>
              </div>
              <button
                type="button"
                className={styles.expandBtn}
                onClick={() => {
                  setPaneClosing(false);
                  setExpandedSource(card.id);
                }}
                title={`Expand ${meta.label}`}
                aria-label={`Expand ${meta.label}`}
              >
                Expand
              </button>
            </header>

            <div className={styles.categoryBody}>
              <div className={styles.categoryStat}>
                <span
                  className={styles.categoryPrimary}
                  data-tone={card.warn ? "warn" : undefined}
                >
                  {card.primary}
                </span>
                <span className={styles.categoryPrimaryLabel}>{card.primaryLabel}</span>
                <span className={styles.categorySecondary}>{card.secondary}</span>
              </div>

              {card.preview.length === 0 ? (
                <p className={styles.categoryEmpty}>No live data yet</p>
              ) : (
                <ul className={styles.previewList}>
                  {card.preview.map((row) => {
                    const fresh = isNew(row.key);
                    return (
                      <li
                        key={row.key}
                        className={
                          fresh
                            ? `${styles.previewItem} ${styles.enter}`
                            : styles.previewItem
                        }
                        data-risk={row.risk === "elevated" ? "elevated" : undefined}
                      >
                        <span className={styles.previewTop}>
                          <span className={styles.previewTitle}>
                            {fresh ? <span className={styles.dot} aria-label="New" /> : null}
                            {row.title}
                          </span>
                        </span>
                        <span className={styles.previewDetail}>{row.detail}</span>
                        {row.ts ? (
                          <span className={styles.previewWhen}>{relativeTime(row.ts, now)}</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              <button
                type="button"
                className={styles.viewAll}
                onClick={() => {
                  setPaneClosing(false);
                  setExpandedSource(card.id);
                }}
              >
                View by floor
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );

  return createPortal(
    <div
      className={styles.overlay}
      data-closing={overlayClosing ? "true" : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Plant overview"
    >
      <div
        className={styles.overlayPanel}
        onAnimationEnd={(e) => {
          if (e.target !== e.currentTarget) return;
          if (overlayClosing) onClosed();
        }}
      >
        <header className={styles.overlayHeader}>
          <div className={styles.headerText}>
            <div className={styles.titleRow}>
              <h2 className={styles.overlayTitle}>
                {expandedMeta ? expandedMeta.label : "Plant overview"}
              </h2>
              {sampleCount > 0 ? (
                <span className={styles.liveDot} title="Live data" />
              ) : null}
            </div>
            <p className={styles.overlaySubtitle}>
              {expandedMeta
                ? `${expandedMeta.mark} · by floor`
                : "Ops impact and live plant feed across SCADA, permits, maintenance, and workforce"}
            </p>
          </div>
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.ctrl}
              onClick={onRequestClose}
              aria-label="Close overview"
            >
              Close
            </button>
          </div>
        </header>

        <div className={styles.overlayBody}>
          <div
            className={styles.section}
            data-hidden={visiblePaneSource ? "true" : undefined}
          >
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>Ops KPIs</h3>
            </div>
            {kpiGrid}
          </div>
          <div
            className={`${styles.section} ${styles.liveSection}`}
            data-expanded={visiblePaneSource ? "true" : undefined}
          >
            {!visiblePaneSource ? (
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Plant feed</h3>
                <span className={styles.feedSummary}>All sources</span>
              </div>
            ) : null}

            <div className={styles.feedStage}>
              <div className={styles.feedScroll}>{allCategoriesGrid}</div>

              {visiblePaneSource ? (
                <div
                  key={visiblePaneSource}
                  className={styles.expandPane}
                  data-closing={paneClosing ? "true" : undefined}
                  style={{ transformOrigin: ORIGIN_BY_SOURCE[visiblePaneSource] }}
                  role="region"
                  aria-label={`${expandedMeta?.label} by floor`}
                  onAnimationEnd={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (paneClosing) setPaneClosing(false);
                  }}
                >
                  <div className={styles.expandPaneHead}>
                    <button
                      type="button"
                      className={styles.backBtn}
                      onClick={collapsePane}
                      aria-label="Back to overview"
                    >
                      Back
                    </button>
                    <div className={styles.expandPaneTitles}>
                      <span className={styles.categoryMark}>{expandedMeta?.mark}</span>
                      <h3 className={styles.expandPaneTitle}>{expandedMeta?.label}</h3>
                    </div>
                    <button
                      type="button"
                      className={styles.ctrl}
                      onClick={collapsePane}
                      aria-label="Collapse category"
                    >
                      Collapse
                    </button>
                  </div>
                  <div className={styles.expandPaneBody}>{floorBoard}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Shell (light subscriptions only) ───────────────────────────────────────

export function OverviewPanel() {
  const views = useLiveAssetViews();
  const opsSummary = useLiveStore((s) => s.opsSummary);
  const selectAsset = useLiveStore((s) => s.selectAsset);

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayClosing, setOverlayClosing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const afterCloseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const kpis = useMemo(() => {
    const openReviews = views.filter((v) => v.review != null && v.review.state !== "closed").length;
    const zones = new Set<string>();
    for (const v of views) {
      if (isElevatedOrBlocking(v) && v.asset.zone) zones.add(v.asset.zone);
    }
    const peopleAtRisk = opsSummary.peopleAtRisk;
    const blockedWork = views.filter(isBlockedWork).length;
    return [
      { key: "open", label: "Open reviews", value: openReviews, warn: openReviews > 0 },
      { key: "zones", label: "Zones locked", value: zones.size, warn: zones.size > 0 },
      { key: "people", label: "People at risk", value: peopleAtRisk, warn: peopleAtRisk > 0 },
      { key: "blocked", label: "Blocked work", value: blockedWork, warn: blockedWork > 0 },
    ];
  }, [views, opsSummary.peopleAtRisk]);

  const openMaximize = useCallback(() => {
    afterCloseRef.current = null;
    setOverlayClosing(false);
    setOverlayOpen(true);
  }, []);

  const finishClose = useCallback(() => {
    setOverlayOpen(false);
    setOverlayClosing(false);
    const after = afterCloseRef.current;
    afterCloseRef.current = null;
    after?.();
  }, []);

  const closeMaximize = useCallback(() => {
    if (!overlayOpen || overlayClosing) return;
    setOverlayClosing(true);
  }, [overlayOpen, overlayClosing]);

  const goToAsset = useCallback(
    (assetId: string) => {
      afterCloseRef.current = () => selectAsset(assetId);
      if (!overlayOpen) {
        selectAsset(assetId);
        return;
      }
      if (overlayClosing) return;
      setOverlayClosing(true);
    },
    [overlayOpen, overlayClosing, selectAsset],
  );

  const kpiGrid = (
    <div className={styles.kpis} aria-label="Ops KPIs">
      {kpis.map((k) => (
        <div
          key={k.key}
          className={styles.kpi}
          data-tone={k.warn ? "warn" : k.value === 0 ? "good" : undefined}
        >
          <span className={styles.kpiValue}>{k.value}</span>
          <span className={styles.kpiLabel}>{k.label}</span>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div className={styles.embedded} role="region" aria-label="Plant overview">
        <div className={styles.header}>
          <div className={styles.headerText}>
            <div className={styles.titleRow}>
              <h2 className={styles.panelTitle}>Overview</h2>
              {opsSummary.assetsWithOps > 0 ? (
                <span className={styles.liveDot} title="Live data" />
              ) : null}
            </div>
            <p className={styles.panelSubtitle}>Ops impact across open work</p>
          </div>
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.ctrl}
              onClick={openMaximize}
              aria-label="Expand overview"
            >
              Expand
            </button>
          </div>
        </div>
        <div className={styles.embeddedBody}>{kpiGrid}</div>
      </div>
      {mounted && overlayOpen ? (
        <OverviewFeedOverlay
          kpiGrid={kpiGrid}
          overlayClosing={overlayClosing}
          onRequestClose={closeMaximize}
          onClosed={finishClose}
          onGoToAsset={goToAsset}
        />
      ) : null}
    </>
  );
}
