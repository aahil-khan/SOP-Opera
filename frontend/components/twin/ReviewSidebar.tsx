"use client";

import {
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
import {
  OPEN_WORK_COLUMNS,
  columnForReviewState,
  nextActionForView,
  ownerNameForView,
  type OpenWorkColumnId,
} from "@/lib/openWork";
import { relativeTime } from "@/lib/relativeTime";
import { useNewEntries } from "@/lib/useNewEntries";
import { OverviewPanel } from "./OverviewPanel";
import styles from "./ReviewSidebar.module.css";

interface ReviewSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  affectedCount: number;
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
  const when = view.review?.created_at
    ? relativeTime(view.review.created_at, now)
    : null;

  return (
    <button
      type="button"
      className={styles.item}
      data-active={active}
      data-risk={view.risk_level}
      onClick={onSelect}
    >
      <span className={styles.itemTop}>
        <span className={styles.itemName}>
          {isNew ? <span className={styles.dot} aria-label="New" /> : null}
          {view.asset.name}
        </span>
        <span className="badge" data-risk={view.risk_level}>
          {view.risk_level}
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
}: ReviewSidebarProps) {
  const allViews = useLiveAssetViews();
  const selectedAssetId = useLiveStore((s) => s.selectedAssetId);
  const selectAsset = useLiveStore((s) => s.selectAsset);

  const [activeColumn, setActiveColumn] = useState<OpenWorkColumnId>("awaiting_decision");
  const tablistRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<OpenWorkColumnId, HTMLButtonElement | null>>>({});
  const [slider, setSlider] = useState({ left: 0, width: 0 });

  const views = useMemo(
    () =>
      allViews.filter(
        (v) =>
          v.review != null ||
          (v.risk_level !== "nominal" && v.detail?.derived_facts?.length),
      ),
    [allViews],
  );

  const byColumn = useMemo(() => {
    const cols: Record<OpenWorkColumnId, LiveAssetView[]> = {
      investigating: [],
      awaiting_decision: [],
      closed: [],
    };
    for (const v of views) {
      cols[columnForReviewState(v.review?.state)].push(v);
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
  const activeColMeta = OPEN_WORK_COLUMNS.find((c) => c.id === activeColumn);
  const showNew = activeColumn !== "closed";

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
    return () => ro.disconnect();
  }, [activeColumn, byColumn]);

  useEffect(() => {
    tabRefs.current[activeColumn]?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeColumn]);

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
          <div className={styles.headerControls}>
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
                  tabIndex={selected ? 0 : -1}
                  className={styles.columnTab}
                  data-active={selected ? "true" : undefined}
                  onClick={() => setActiveColumn(col.id)}
                >
                  <span className={styles.columnTabLabel}>{col.label}</span>
                  <span className={styles.columnTabCount}>
                    {byColumn[col.id].length}
                    {colHasNew ? (
                      <span className={styles.dot} aria-hidden="true" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

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
              ) : (
                items.map((v) => {
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
                        onSelect={() => selectAsset(v.asset.id)}
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
