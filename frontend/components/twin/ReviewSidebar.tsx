"use client";

import { useEffect, useRef } from "react";
import {
  getLiveAssetViews,
  useLiveStore,
  type LiveAssetView,
} from "@/lib/liveStore";
import {
  OPEN_WORK_COLUMNS,
  columnForReviewState,
  nextActionForView,
  ownerNameForView,
  type OpenWorkColumnId,
} from "@/lib/openWork";
import { useFloatingPanel } from "./useFloatingPanel";
import styles from "./ReviewSidebar.module.css";
import floatStyles from "./floatingPanel.module.css";

const MIN_SIDEBAR_W = 240;
const MAX_SIDEBAR_W = 600;
const MIN_SIDEBAR_H = 220;

interface ReviewSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  affectedCount: number;
  width: number;
  onWidthChange: (w: number) => void;
  onFloatingChange?: (floating: boolean) => void;
}

function WorkCard({
  view,
  active,
  onSelect,
}: {
  view: LiveAssetView;
  active: boolean;
  onSelect: () => void;
}) {
  const next = nextActionForView(view);
  const owner = ownerNameForView(view);
  return (
    <button
      type="button"
      className={styles.item}
      data-active={active}
      data-risk={view.risk_level}
      onClick={onSelect}
    >
      <span className={styles.itemTop}>
        <span className={styles.itemName}>{view.asset.name}</span>
        <span className="badge" data-risk={view.risk_level}>
          {view.risk_level}
        </span>
      </span>
      <span className={styles.itemMeta}>
        {view.asset.zone}
        {view.review
          ? ` · ${view.review.state.replaceAll("_", " ")}`
          : " · signal"}
      </span>
      <span className={styles.itemFooter}>
        <span className={styles.nextLine}>
          <span className={styles.footerLabel}>Next</span> {next}
        </span>
        {owner ? (
          <span className={styles.ownerLine}>
            <span className={styles.footerLabel}>Owner</span> {owner}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function ReviewSidebar({
  open,
  onOpenChange,
  affectedCount,
  width,
  onWidthChange,
  onFloatingChange,
}: ReviewSidebarProps) {
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  const {
    panelRef,
    floating,
    interacting,
    isDragging,
    style: floatStyle,
    onHeaderPointerDown,
    onResizePointerDown,
    onPointerMove,
    onPointerUp,
    snapToDefault,
  } = useFloatingPanel({ minW: MIN_SIDEBAR_W, minH: MIN_SIDEBAR_H });

  useEffect(() => {
    onFloatingChange?.(floating);
  }, [floating, onFloatingChange]);

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

  const byColumn: Record<OpenWorkColumnId, LiveAssetView[]> = {
    investigating: [],
    awaiting_decision: [],
    closed: [],
  };
  for (const v of views) {
    const col = columnForReviewState(v.review?.state);
    byColumn[col].push(v);
  }

  return (
    <>
      <button
        type="button"
        className={styles.rail}
        data-open={open}
        onClick={() => onOpenChange(true)}
        aria-expanded={open}
        aria-controls="open-work-panel"
        title="Open work"
      >
        <span className={styles.railLabel}>Open work</span>
        {affectedCount > 0 && (
          <span className={styles.railCount}>{affectedCount}</span>
        )}
      </button>

      {isDragging && (
        <div
          className={`${styles.sidebar} ${floatStyles.homeGhost}`}
          style={{ width, bottom: "calc(var(--left-bottom-h, 0px) + var(--space-3) + 8px)" }}
          aria-hidden="true"
        />
      )}

      <aside
        id="open-work-panel"
        ref={panelRef}
        className={styles.sidebar}
        data-open={open}
        data-floating={floating ? "true" : undefined}
        data-interacting={interacting ? "true" : undefined}
        aria-label="Open work board"
        aria-hidden={!open}
        style={
          floating
            ? floatStyle
            : { width, bottom: "calc(var(--left-bottom-h, 0px) + var(--space-3) + 8px)" }
        }
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {!floating && (
          <div
            className={styles.resizeHandle}
            aria-hidden="true"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              resizeRef.current = { startX: e.clientX, startW: width };
            }}
            onPointerMove={(e) => {
              if (!resizeRef.current) return;
              const dx = e.clientX - resizeRef.current.startX;
              onWidthChange(Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, resizeRef.current.startW + dx)));
            }}
            onPointerUp={() => { resizeRef.current = null; }}
          />
        )}
        <header className={styles.header} onPointerDown={onHeaderPointerDown}>
          <span className={styles.grip} aria-hidden="true">⠿</span>
          <div className={styles.headerText}>
            <h2 className={styles.title}>Open work</h2>
            <p className={styles.subtitle}>Calls for help · select to locate</p>
          </div>
          <div className={styles.headerControls}>
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
              className={styles.collapse}
              onClick={() => onOpenChange(false)}
              aria-label="Collapse sidebar"
              title="Collapse"
            >
              ‹
            </button>
          </div>
        </header>

        {views.length === 0 ? (
          <p className={styles.empty}>
            No active signals. Ingest context or start a simulator scenario.
          </p>
        ) : (
          <div className={styles.board} role="list">
            {OPEN_WORK_COLUMNS.map((col) => {
              const items = byColumn[col.id];
              return (
                <section
                  key={col.id}
                  className={styles.column}
                  aria-label={col.label}
                >
                  <header className={styles.columnHeader}>
                    <span className={styles.columnTitle}>{col.label}</span>
                    <span className={styles.columnCount}>{items.length}</span>
                  </header>
                  <ul className={styles.columnList}>
                    {items.length === 0 ? (
                      <li className={styles.columnEmpty}>—</li>
                    ) : (
                      items.map((v) => (
                        <li key={v.review?.id ?? v.asset.id} role="listitem">
                          <WorkCard
                            view={v}
                            active={selectedAssetId === v.asset.id}
                            onSelect={() => selectAsset(v.asset.id)}
                          />
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {floating && (
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
      </aside>
    </>
  );
}
