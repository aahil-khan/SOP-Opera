"use client";

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
import styles from "./ReviewSidebar.module.css";

interface ReviewSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  affectedCount: number;
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
}: ReviewSidebarProps) {
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

      <aside
        id="open-work-panel"
        className={styles.sidebar}
        data-open={open}
        aria-label="Open work board"
        aria-hidden={!open}
      >
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>Open work</h2>
            <p className={styles.subtitle}>Calls for help · select to locate</p>
          </div>
          <button
            type="button"
            className={styles.collapse}
            onClick={() => onOpenChange(false)}
            aria-label="Collapse sidebar"
            title="Collapse"
          >
            ‹
          </button>
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
      </aside>
    </>
  );
}
