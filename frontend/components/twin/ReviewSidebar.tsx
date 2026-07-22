"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useLiveAssetViews,
  useLiveStore,
  type LiveAssetView,
} from "@/lib/liveStore";
import { openWorkDisplayRisk } from "@/lib/sensorThresholds";
import {
  OPEN_WORK_COLUMNS,
  columnForView,
  nextActionForView,
  ownerNameForView,
  workStatusForView,
  type OpenWorkColumnId,
} from "@/lib/openWork";
import { relativeTime } from "@/lib/relativeTime";
import { useNewEntries } from "@/lib/useNewEntries";
import { OverviewPanel } from "./OverviewPanel";
import { useHorizontalResize } from "./useHorizontalResize";
import styles from "./ReviewSidebar.module.css";

interface ReviewSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  affectedCount: number;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
}

type RiskFilter = "all" | "critical" | "blocking" | "elevated";

const RISK_FILTERS: { id: RiskFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "blocking", label: "Blocking" },
  { id: "elevated", label: "Elevated" },
];

function matchesSearch(view: LiveAssetView, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const status = workStatusForView(view);
  const owner = ownerNameForView(view) ?? "";
  const next = nextActionForView(view);
  const haystack = [
    view.asset.name,
    view.asset.zone,
    view.review?.state.replaceAll("_", " ") ?? "signal",
    status.label,
    owner,
    next,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function matchesRiskFilter(view: LiveAssetView, riskFilter: RiskFilter): boolean {
  if (riskFilter === "all") return true;
  const displayRisk = openWorkDisplayRisk(view.risk_level, view.sensor_critical);
  return displayRisk === riskFilter;
}

function filterWorkItems(
  items: LiveAssetView[],
  searchQuery: string,
  riskFilter: RiskFilter,
): LiveAssetView[] {
  const query = searchQuery.trim();
  if (!query && riskFilter === "all") return items;
  return items.filter(
    (v) => matchesSearch(v, query) && matchesRiskFilter(v, riskFilter),
  );
}

function arrivedAt(view: LiveAssetView): number {
  if (view.review?.created_at) {
    const t = Date.parse(view.review.created_at);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function ListeningOrbit({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? styles.orbitCompact : styles.orbit}
      aria-hidden
    >
      <span className={styles.orbitRing} data-ring="outer" />
      <span className={styles.orbitRing} data-ring="mid" />
      <span className={styles.orbitCore} />
      <span className={styles.orbitBlip}>
        <span className={styles.orbitBlipDot} />
      </span>
    </div>
  );
}

function WorkCard({
  view,
  active,
  isNew,
  now,
  onSelect,
}: {
  view: LiveAssetView;
  active: boolean;
  isNew: boolean;
  now: number;
  onSelect: () => void;
}) {
  const next = nextActionForView(view);
  const owner = ownerNameForView(view);
  const status = workStatusForView(view);
  const when = view.review?.created_at
    ? relativeTime(view.review.created_at, now)
    : null;

  return (
    <button
      type="button"
      className={styles.item}
      data-active={active}
      data-risk={status.badgeRisk}
      data-resolved={status.resolved ? "true" : undefined}
      onClick={onSelect}
    >
      <span className={styles.itemTop}>
        <span className={styles.itemName}>
          {isNew ? <span className={styles.dot} aria-label="New" /> : null}
          {view.asset.name}
        </span>
        <span className={`badge ${styles.itemBadge}`} data-risk={status.badgeRisk}>
          {status.label}
        </span>
      </span>
      <span className={styles.itemMeta}>
        {view.asset.zone}
        {view.review
          ? ` · ${view.review.state.replaceAll("_", " ")}`
          : " · signal"}
        {when ? ` · ${when}` : null}
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
  minWidth,
  maxWidth,
  onWidthChange,
  onResizingChange,
}: ReviewSidebarProps) {
  const allViews = useLiveAssetViews();
  const selectedAssetId = useLiveStore((s) => s.selectedAssetId);
  const selectAsset = useLiveStore((s) => s.selectAsset);

  const [activeColumn, setActiveColumn] = useState<OpenWorkColumnId>("awaiting_decision");
  const [searchQuery, setSearchQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const tablistRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<OpenWorkColumnId, HTMLButtonElement | null>>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const { resizing, handleProps } = useHorizontalResize({
    width,
    onWidthChange,
    minWidth,
    maxWidth,
    edge: "e",
    disabled: !open,
  });

  useEffect(() => {
    onResizingChange?.(resizing);
  }, [resizing, onResizingChange]);
  const [slider, setSlider] = useState({ left: 0, width: 0 });

  const hasActiveFilter = searchQuery.trim().length > 0 || riskFilter !== "all";

  const views = useMemo(
    () =>
      allViews.filter((v) => {
        // Cleared closed incidents leave the open-work board; report is the archive.
        if (v.map_cleared && v.review?.state === "closed") return false;
        return (
          v.review != null ||
          (v.risk_level !== "nominal" && v.detail?.derived_facts?.length)
        );
      }),
    [allViews],
  );

  const byColumn = useMemo(() => {
    const cols: Record<OpenWorkColumnId, LiveAssetView[]> = {
      investigating: [],
      awaiting_decision: [],
      awaiting_fix: [],
      ready_to_close: [],
      closed: [],
    };
    for (const v of views) {
      cols[columnForView(v)].push(v);
    }
    for (const id of Object.keys(cols) as OpenWorkColumnId[]) {
      cols[id].sort((a, b) => arrivedAt(b) - arrivedAt(a));
    }
    return cols;
  }, [views]);

  const entryIds = useMemo(
    () => views.map((v) => v.review?.id ?? `signal:${v.asset.id}`),
    [views],
  );
  const { isNew, now } = useNewEntries(entryIds);

  const items = byColumn[activeColumn];
  const filteredItems = useMemo(
    () => filterWorkItems(items, searchQuery, riskFilter),
    [items, searchQuery, riskFilter],
  );
  const activeColMeta = OPEN_WORK_COLUMNS.find((c) => c.id === activeColumn);
  const showNew = activeColumn !== "closed";

  const clearFilters = useCallback(() => {
    setSearchQuery("");
    setRiskFilter("all");
    searchRef.current?.focus();
  }, []);

  const toggleFilters = useCallback(() => {
    setFiltersOpen((open) => !open);
  }, []);

  useEffect(() => {
    if (filtersOpen) {
      searchRef.current?.focus();
    }
  }, [filtersOpen]);

  useLayoutEffect(() => {
    const track = tablistRef.current;
    const tab = tabRefs.current[activeColumn];
    if (!track || !tab) return;

    const update = () => {
      setSlider({
        left: tab.offsetLeft,
        width: tab.offsetWidth,
      });
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(track);
    ro.observe(tab);
    return () => {
      ro.disconnect();
    };
  }, [activeColumn, byColumn, open, width]);

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
        data-resizing={resizing ? "true" : undefined}
        aria-label="Open work board"
        aria-hidden={!open}
      >
        <div
          className={styles.resizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize open work panel"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={open ? 0 : -1}
          {...handleProps}
        />
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h2 className={styles.title}>Open work</h2>
            <p className={styles.subtitle}>Calls for help · select to locate</p>
          </div>
          <div className={styles.headerControls}>
            {views.length > 0 ? (
              <button
                type="button"
                className={styles.filterToggle}
                data-open={filtersOpen ? "true" : undefined}
                data-active={hasActiveFilter ? "true" : undefined}
                onClick={toggleFilters}
                aria-expanded={filtersOpen}
                aria-controls="open-work-filters"
                aria-label={
                  hasActiveFilter
                    ? "Search and filter open work (filters active)"
                    : "Search and filter open work"
                }
                title="Search & filter"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                {hasActiveFilter ? (
                  <span className={styles.filterActiveDot} aria-hidden />
                ) : null}
              </button>
            ) : null}
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

        <div className={styles.columnTabs} aria-label="Work columns">
          <div
            ref={tablistRef}
            className={styles.columnTabTrack}
            role="tablist"
            aria-orientation="horizontal"
          >
            <span
              className={styles.columnTabSlider}
              aria-hidden
              style={{
                transform: `translateX(${slider.left}px)`,
                width: slider.width,
              }}
            />
            {OPEN_WORK_COLUMNS.map((col) => {
              const selected = activeColumn === col.id;
              const count = byColumn[col.id].length;
              const colHasNew =
                col.id !== "closed" &&
                byColumn[col.id].some((v) =>
                  isNew(v.review?.id ?? `signal:${v.asset.id}`),
                );
              return (
                <button
                  key={col.id}
                  ref={(el) => {
                    tabRefs.current[col.id] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={`${col.label}, ${count}`}
                  title={col.label}
                  tabIndex={selected ? 0 : -1}
                  className={styles.columnTab}
                  data-active={selected ? "true" : undefined}
                  data-has-items={count > 0 ? "true" : undefined}
                  onClick={() => setActiveColumn(col.id)}
                >
                  <span className={styles.columnTabLabel}>{col.shortLabel}</span>
                  <span className={styles.columnTabCount}>
                    {count}
                    {colHasNew ? (
                      <span className={styles.dot} aria-hidden="true" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          {activeColMeta ? (
            <p className={styles.columnStageLabel} aria-live="polite">
              {activeColMeta.label}
            </p>
          ) : null}
        </div>

        {views.length > 0 && filtersOpen ? (
          <div id="open-work-filters" className={styles.filters}>
              <div className={styles.searchWrap}>
                <svg
                  className={styles.searchIcon}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  ref={searchRef}
                  type="search"
                  className={styles.searchInput}
                  placeholder="Search assets, zones, owners…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search open work"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className={styles.searchClear}
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    ×
                  </button>
                ) : null}
              </div>
              <div className={styles.riskFilters} role="group" aria-label="Filter by risk">
                {RISK_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={styles.riskChip}
                    data-active={riskFilter === f.id ? "true" : undefined}
                    data-risk={f.id !== "all" ? f.id : undefined}
                    onClick={() => setRiskFilter(f.id)}
                    aria-pressed={riskFilter === f.id}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {hasActiveFilter && items.length > 0 ? (
                <p className={styles.filterMeta} role="status">
                  {filteredItems.length} of {items.length}
                  {filteredItems.length === 0 ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className={styles.filterClearLink}
                        onClick={clearFilters}
                      >
                        Clear filters
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
        ) : null}

        {views.length === 0 ? (
          <div className={styles.emptyState} role="status">
            <ListeningOrbit />
            <p className={styles.emptyTitle}>Listening for signals</p>
            <p className={styles.emptyCopy}>
              Open work will land here when an asset needs attention
            </p>
          </div>
        ) : (
          <section className={styles.column} aria-label={activeColMeta?.label}>
            <ul className={styles.columnList}>
              {items.length === 0 ? (
                <li className={styles.columnEmpty} role="status">
                  <ListeningOrbit compact />
                  <p className={styles.emptyTitle}>Nothing in {activeColMeta?.label ?? "this column"}</p>
                  <p className={styles.emptyCopy}>
                    Work will appear as reviews move into this stage.
                  </p>
                </li>
              ) : filteredItems.length === 0 ? (
                <li className={styles.columnEmpty} role="status">
                  <p className={styles.emptyTitle}>No matches</p>
                  <p className={styles.emptyCopy}>
                    Try a different search term or risk filter.
                  </p>
                  <button
                    type="button"
                    className={styles.filterClearBtn}
                    onClick={() => {
                      clearFilters();
                      setFiltersOpen(true);
                    }}
                  >
                    Clear filters
                  </button>
                </li>
              ) : (
                filteredItems.map((v) => {
                  const id = v.review?.id ?? `signal:${v.asset.id}`;
                  const fresh = showNew && isNew(id);
                  return (
                    <li
                      key={id}
                      role="listitem"
                      className={fresh ? styles.enter : undefined}
                    >
                      <WorkCard
                        view={v}
                        active={selectedAssetId === v.asset.id}
                        isNew={fresh}
                        now={now}
                        onSelect={() =>
                          selectAsset(
                            v.asset.id,
                            activeColumn === "closed" ? "closure" : "live",
                          )
                        }
                      />
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        )}

        {open ? <OverviewPanel /> : null}
      </aside>
    </>
  );
}
