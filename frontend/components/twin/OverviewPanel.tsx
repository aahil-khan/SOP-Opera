"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLiveAssetViews,
  useLiveStore,
  type TelemetryMetricKey,
  type TelemetrySample,
} from "@/lib/liveStore";
import { isBlockedWork, isElevatedOrBlocking } from "@/lib/openWork";
import { useFloatingPanel } from "./useFloatingPanel";
import styles from "./OverviewPanel.module.css";
import floatStyles from "./floatingPanel.module.css";

// ── Constants ──────────────────────────────────────────────────────────────

const MIN_W = 300;
const MIN_H = 180;
const DEFAULT_W = 460;
const SCADA_ROTATE_MS = 5000;

// ── Telemetry helpers ──────────────────────────────────────────────────────

const SOURCES = [
  { id: "scada", label: "SCADA" },
  { id: "ptw", label: "PTW" },
  { id: "maintenance", label: "Maint" },
  { id: "workforce", label: "Workforce" },
] as const;

const METRIC_META: Record<TelemetryMetricKey, { label: string; unit: string; warnAt?: number }> = {
  gas_reading:   { label: "Gas",   unit: "ppm",  warnAt: 20 },
  temp_reading:  { label: "Temp",  unit: "°C",   warnAt: 80 },
  vibration_mm_s:{ label: "Vibe",  unit: "mm/s", warnAt: 7.1 },
  level_pct:     { label: "Level", unit: "%" },
  ph:            { label: "pH",    unit: "" },
  wind_ms:       { label: "Wind",  unit: "m/s",  warnAt: 15 },
};

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

function countActivePermits(status: { category: string; label: string }[]): number {
  return status.filter((s) => s.category === "permit" && s.label.toLowerCase().includes("active")).length;
}

function countHazardousWorkers(status: { category: string; label: string }[]): number {
  return status.filter(
    (s) => s.category === "worker_location" && s.label.toLowerCase().includes("hazardous"),
  ).length;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface OverviewPanelProps {
  shiftForDrawer?: boolean;
  docked?: boolean;
  dockedWidth?: number;
}

// ── Component ──────────────────────────────────────────────────────────────

export function OverviewPanel({ shiftForDrawer = false, docked = false, dockedWidth = 360 }: OverviewPanelProps) {
  const assets            = useLiveStore((s) => s.assets);
  const reviews           = useLiveStore((s) => s.reviews);
  const reviewDetails     = useLiveStore((s) => s.reviewDetails);
  const assessmentsByReview = useLiveStore((s) => s.assessmentsByReview);
  const telemetryStatus   = useLiveStore((s) => s.telemetryStatus);
  const bySource          = useLiveStore((s) => s.telemetryBySource);
  const selectAsset       = useLiveStore((s) => s.selectAsset);

  const [collapsed,   setCollapsed]  = useState(false);
  const [feedSource,  setFeedSource] = useState<(typeof SOURCES)[number]["id"]>("scada");
  const [scadaIdx,    setScadaIdx]   = useState(0);

  const {
    panelRef,
    floating,
    interacting,
    isDragging,
    isResized,
    size,
    style: floatStyle,
    onHeaderPointerDown,
    onResizePointerDown,
    onPointerMove,
    onPointerUp,
    snapToDefault,
    maximize,
  } = useFloatingPanel({ minW: MIN_W, minH: MIN_H });

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const views = getLiveAssetViews({ assets, reviews, reviewDetails, assessmentsByReview });
    const openReviews = views.filter((v) => v.review != null && v.review.state !== "closed").length;
    const zones = new Set<string>();
    for (const v of views) {
      if (isElevatedOrBlocking(v) && v.asset.zone) zones.add(v.asset.zone);
    }
    const peopleAtRisk = countHazardousWorkers(telemetryStatus);
    const blockedWork  = views.filter(isBlockedWork).length;
    return [
      { key: "open",    label: "Open reviews",   value: openReviews,  warn: openReviews > 0 },
      { key: "zones",   label: "Zones locked",   value: zones.size,   warn: zones.size > 0 },
      { key: "people",  label: "People at risk",  value: peopleAtRisk, warn: peopleAtRisk > 0 },
      { key: "blocked", label: "Blocked work",    value: blockedWork,  warn: blockedWork > 0 },
    ];
  }, [assets, reviews, reviewDetails, assessmentsByReview, telemetryStatus]);

  // ── SCADA assets + rotation ───────────────────────────────────────────────

  const scadaAssets = useMemo(() => getScadaAssets(bySource), [bySource]);

  // Clamp index on list change
  useEffect(() => {
    if (scadaAssets.length > 0) setScadaIdx((i) => i % scadaAssets.length);
  }, [scadaAssets.length]);

  // Auto-rotate only when panel is too small to show all assets
  const panelW = size?.w ?? DEFAULT_W;
  const panelH = size?.h ?? null;
  const dockedNow = docked && !floating;
  // When sitting in its default docked slot, the panel fills a defined
  // height — always show every asset. Same once floating-resized tall.
  const showAllScada = feedSource === "scada" && (dockedNow || (panelH != null && panelH > 320));

  useEffect(() => {
    if (showAllScada || feedSource !== "scada" || scadaAssets.length < 2) return;
    const id = window.setInterval(() => setScadaIdx((i) => (i + 1) % scadaAssets.length), SCADA_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [showAllScada, feedSource, scadaAssets.length]);

  // ── Feed cards (single-asset cycling) ────────────────────────────────────

  const feedCards = useMemo(() => {
    if (feedSource === "scada") {
      if (scadaAssets.length === 0) return [];
      return metricsForAsset(scadaAssets[scadaIdx % scadaAssets.length]);
    }
    if (feedSource === "ptw") {
      const count = countActivePermits(telemetryStatus);
      return [{ key: "permits", label: "Active permits", value: String(count), unit: "", risk: count > 1 ? "elevated" : "nominal" }];
    }
    if (feedSource === "maintenance") {
      const incomplete = telemetryStatus.filter(
        (s) => s.category === "isolation_status" && s.label.toLowerCase().includes("incomplete"),
      ).length;
      return [{ key: "iso", label: "Isolation flags", value: String(incomplete), unit: "", risk: incomplete ? "elevated" : "nominal" }];
    }
    const hazardous = countHazardousWorkers(telemetryStatus);
    return [{ key: "zone", label: "In hazardous zone", value: String(hazardous), unit: "", risk: hazardous > 0 ? "elevated" : "nominal" }];
  }, [bySource, feedSource, telemetryStatus, scadaAssets, scadaIdx]);

  const currentScadaAsset = feedSource === "scada" && !showAllScada && scadaAssets.length > 0
    ? scadaAssets[scadaIdx % scadaAssets.length]
    : null;

  const sampleCount = Object.keys(bySource).length;

  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), []);

  // Escape snaps a floating panel back to its default position
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && floating) snapToDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [floating, snapToDefault]);

  // ── Tier calculation ──────────────────────────────────────────────────────

  const effectiveW = dockedNow ? dockedWidth : panelW;
  const tier = effectiveW >= 680 ? "wide" : effectiveW >= 420 ? "normal" : "compact";
  // isLarge drives the bigger-font styling + the maximize/restore icon —
  // tied to a deliberate resize/maximize, not just being dragged around
  const isLarge = isResized;

  // ── Inline style ──────────────────────────────────────────────────────────

  const inlineStyle: React.CSSProperties = floating ? floatStyle : {};

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {isDragging && (
        <div
          className={`${styles.panel} ${floatStyles.homeGhost}`}
          data-docked={docked ? "true" : undefined}
          aria-hidden="true"
        />
      )}
      <div
        ref={panelRef}
        className={styles.panel}
        data-tier={tier}
        data-tall={showAllScada ? "true" : undefined}
        data-collapsed={collapsed ? "true" : undefined}
        data-large={isLarge ? "true" : undefined}
        data-floating={floating ? "true" : undefined}
        data-docked={dockedNow ? "true" : undefined}
        data-interacting={interacting ? "true" : undefined}
        data-shift={!floating && shiftForDrawer ? "true" : undefined}
        style={inlineStyle}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="region"
        aria-label="Plant overview"
      >
      {/* ── Header ── */}
      <div className={styles.header} onPointerDown={onHeaderPointerDown}>
        <span className={styles.grip} aria-hidden="true">⠿</span>
        <span className={styles.panelTitle}>Overview</span>
        {sampleCount > 0 && <span className={styles.liveDot} title="Live data" />}
        <div className={styles.controls}>
          {floating && (
            <button
              type="button"
              className={floatStyles.snapBack}
              onClick={snapToDefault}
              title="Snap back to default position"
              aria-label="Snap back to default position"
            >
              ↺
            </button>
          )}
          <button
            type="button"
            className={styles.ctrl}
            onClick={toggleCollapse}
            title={collapsed ? "Expand" : "Collapse"}
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
          >
            {collapsed ? "▲" : "▼"}
          </button>
          <button
            type="button"
            className={styles.ctrl}
            onClick={maximize}
            title={isLarge ? "Restore" : "Maximize"}
            aria-label={isLarge ? "Restore panel" : "Maximize panel"}
          >
            {isLarge ? "⤓" : "⤢"}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      {!collapsed && (
        <div className={styles.body}>

          {/* KPIs */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionMark}>Impact</span>
              <span className={styles.sectionTitle}>Ops KPIs</span>
            </div>
            <div className={styles.kpis}>
              {kpis.map((k) => (
                <div key={k.key} className={styles.kpi} data-warn={k.warn ? "true" : undefined}>
                  <span className={styles.kpiValue}>{k.value}</span>
                  <span className={styles.kpiLabel}>{k.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.divider} />

          {/* Live Plant Feed */}
          <div className={`${styles.section} ${styles.liveSection}`}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionMarkGreen}>Live</span>
              <span className={styles.sectionTitle}>Plant feed</span>
              {currentScadaAsset && (
                <span key={currentScadaAsset.asset_id} className={styles.assetCycleLabel}>
                  {currentScadaAsset.asset_name ?? currentScadaAsset.asset_id}
                  {scadaAssets.length > 1 && (
                    <span className={styles.assetCycleCount}>
                      {" "}{(scadaIdx % scadaAssets.length) + 1}/{scadaAssets.length}
                    </span>
                  )}
                </span>
              )}
              <div className={styles.feedTabs} role="tablist" aria-label="Data source">
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={feedSource === s.id}
                    className={styles.feedTab}
                    data-active={feedSource === s.id ? "true" : undefined}
                    onClick={() => setFeedSource(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.feedScroll}>
              {/* Single-asset cycling (small panel) */}
              {!showAllScada && (
                <div className={styles.cards}>
                  {feedCards.length === 0 ? (
                    <p className={styles.feedEmpty}>
                      {feedSource === "scada"
                        ? "No live SCADA telemetry yet."
                        : "No data for this source yet."}
                    </p>
                  ) : (
                    feedCards.map((c) => {
                      const assetId = feedSource === "scada" && currentScadaAsset ? currentScadaAsset.asset_id : null;
                      return assetId ? (
                        <button
                          key={c.key}
                          type="button"
                          className={`${styles.card} ${styles.cardClickable}`}
                          data-risk={c.risk}
                          onClick={() => selectAsset(assetId)}
                          title={`Go to ${currentScadaAsset?.asset_name ?? assetId}`}
                        >
                          <span className={styles.cardLabel}>{c.label}</span>
                          <span className={styles.cardValue}>
                            {c.value}
                            {c.unit ? <span className={styles.unit}>{c.unit}</span> : null}
                          </span>
                        </button>
                      ) : (
                        <div key={c.key} className={styles.card} data-risk={c.risk}>
                          <span className={styles.cardLabel}>{c.label}</span>
                          <span className={styles.cardValue}>
                            {c.value}
                            {c.unit ? <span className={styles.unit}>{c.unit}</span> : null}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* All assets (tall panel) */}
              {showAllScada && (
                <div className={styles.allAssets}>
                  {scadaAssets.length === 0 ? (
                    <p className={styles.feedEmpty}>No live SCADA telemetry yet.</p>
                  ) : (
                    scadaAssets.map((asset) => (
                      <button
                        key={asset.asset_id}
                        type="button"
                        className={`${styles.assetBlock} ${styles.assetBlockClickable}`}
                        onClick={() => selectAsset(asset.asset_id)}
                        title={`Go to ${asset.asset_name ?? asset.asset_id}`}
                      >
                        <div className={styles.assetName}>
                          {asset.asset_name ?? asset.asset_id}
                        </div>
                        <div className={styles.cards}>
                          {metricsForAsset(asset).map((c) => (
                            <div key={c.key} className={styles.card} data-risk={c.risk}>
                              <span className={styles.cardLabel}>{c.label}</span>
                              <span className={styles.cardValue}>
                                {c.value}
                                {c.unit ? <span className={styles.unit}>{c.unit}</span> : null}
                              </span>
                            </div>
                          ))}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ── Resize handles ── */}
      {!collapsed && !dockedNow && (
        <>
          {/* Edges */}
          <div className={`${floatStyles.rh} ${floatStyles.rhN}`}  onPointerDown={(e) => onResizePointerDown(e, "n")}  aria-hidden="true" />
          <div className={`${floatStyles.rh} ${floatStyles.rhS}`}  onPointerDown={(e) => onResizePointerDown(e, "s")}  aria-hidden="true" />
          <div className={`${floatStyles.rh} ${floatStyles.rhE}`}  onPointerDown={(e) => onResizePointerDown(e, "e")}  aria-hidden="true" />
          <div className={`${floatStyles.rh} ${floatStyles.rhW}`}  onPointerDown={(e) => onResizePointerDown(e, "w")}  aria-hidden="true" />
          {/* Corners */}
          <div className={`${floatStyles.rh} ${floatStyles.rhNE}`} onPointerDown={(e) => onResizePointerDown(e, "ne")} aria-hidden="true" />
          <div className={`${floatStyles.rh} ${floatStyles.rhNW}`} onPointerDown={(e) => onResizePointerDown(e, "nw")} aria-hidden="true" />
          <div className={`${floatStyles.rh} ${floatStyles.rhSE}`} onPointerDown={(e) => onResizePointerDown(e, "se")} aria-hidden="true" />
          <div className={`${floatStyles.rh} ${floatStyles.rhSW}`} onPointerDown={(e) => onResizePointerDown(e, "sw")} aria-hidden="true" />
        </>
      )}
      </div>
    </>
  );
}
