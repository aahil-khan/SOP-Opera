"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { fetchRoster } from "@/lib/authApi";
import type { RosterEntry } from "@/lib/authTypes";
import { getActorFromCookie } from "@/lib/actorCookie";
import { useLiveStore } from "@/lib/liveStore";
import {
  fetchTasks,
  fetchAssets,
  fetchSharedReviews,
  fetchRaisedReviews,
  fetchZoneReviews,
  postAcknowledgeTask,
  postDoneTask,
  postSupervisorReport,
  type ReviewTask,
  type SharedReview,
} from "@/lib/liveApi";
import {
  SUPERVISOR_CONCERN_OPTIONS,
  labelSupervisorConcern,
  type SupervisorConcernType,
} from "@/lib/supervisorConcern";
import { lifecycleLabelForReviewState } from "@/lib/openWork";
import { ReviewDetail } from "@/components/reviews/ReviewDetail";
import styles from "./page.module.css";

type TaskStatus = "open" | "acknowledged" | "done";

function taskTypeLabel(taskType: ReviewTask["task_type"]): string {
  return taskType === "unblock" ? "Unblock" : "Follow-up";
}

function lifecycleForReportCard(
  item: SharedReview,
  allTasks: ReviewTask[],
): string {
  if (item.review_state === "decided") {
    const related = allTasks.filter(
      (t) => t.review_id === item.review_id && t.status !== "cancelled",
    );
    if (related.length > 0 && related.every((t) => t.status === "done")) {
      return "Ready to close";
    }
    return "Awaiting fix";
  }
  return lifecycleLabelForReviewState(item.review_state);
}

const COLUMNS: Array<{ key: TaskStatus; label: string }> = [
  { key: "open", label: "Open" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "done", label: "Done" },
];

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

export default function SupervisorPage() {
  const actor = getActorFromCookie();
  const zones = useMemo(() => {
    if (!actor || actor.kind !== "worker") return [];
    return actor.owned_zones;
  }, [actor]);

  const bootstrapped = useLiveStore((s) => s.bootstrapped);
  const bootstrap = useLiveStore((s) => s.bootstrap);
  const taskEventSeq = useLiveStore((s) => s.taskEventSeq);
  const boardEventSeq = useLiveStore((s) => s.boardEventSeq);

  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [sharedReviews, setSharedReviews] = useState<SharedReview[]>([]);
  const [raisedReviews, setRaisedReviews] = useState<SharedReview[]>([]);
  const [zoneReviews, setZoneReviews] = useState<SharedReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);

  const [assetOptions, setAssetOptions] = useState<
    Array<{ id: string; name: string; zone: string }>
  >([]);
  const [workerRoster, setWorkerRoster] = useState<RosterEntry[]>([]);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseBusy, setRaiseBusy] = useState(false);
  const [raiseError, setRaiseError] = useState<string | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [raiseAssetId, setRaiseAssetId] = useState<string | null>(null);
  const [raiseDescription, setRaiseDescription] = useState("");
  const [raiseConcernType, setRaiseConcernType] =
    useState<SupervisorConcernType>("equipment");
  const [assetSearch, setAssetSearch] = useState("");
  const [taggedWorkerIds, setTaggedWorkerIds] = useState<Set<string>>(
    () => new Set(),
  );

  const [doneNotes, setDoneNotes] = useState<Record<string, string>>({});
  const [busyTaskIds, setBusyTaskIds] = useState<Set<string>>(() => new Set());

  const tagOptions = useMemo(
    () => workerRoster.filter((w) => w.id !== actor?.id),
    [workerRoster, actor?.id],
  );

  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    if (!query) return assetOptions;
    return assetOptions.filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        a.zone.toLowerCase().includes(query),
    );
  }, [assetOptions, assetSearch]);

  const assetsByZone = useMemo(() => {
    const grouped = new Map<string, typeof filteredAssets>();
    for (const zone of zones) {
      const zoneAssets = filteredAssets.filter((a) => a.zone === zone);
      if (zoneAssets.length) grouped.set(zone, zoneAssets);
    }
    const otherZones = filteredAssets.filter((a) => !zones.includes(a.zone));
    if (otherZones.length) grouped.set("Other", otherZones);
    return grouped;
  }, [filteredAssets, zones]);

  const selectedRaiseAsset = useMemo(
    () => assetOptions.find((a) => a.id === raiseAssetId) ?? null,
    [assetOptions, raiseAssetId],
  );

  const selectedTask = useMemo(
    () => tasks.find((t) => t.review_id === selectedReviewId) ?? null,
    [tasks, selectedReviewId],
  );

  const selectedShared = useMemo(
    () => sharedReviews.find((s) => s.review_id === selectedReviewId) ?? null,
    [sharedReviews, selectedReviewId],
  );

  const selectedRaised = useMemo(
    () => raisedReviews.find((s) => s.review_id === selectedReviewId) ?? null,
    [raisedReviews, selectedReviewId],
  );

  const closeDrawer = useCallback(() => setSelectedReviewId(null), []);

  const openReportPanel = useCallback(
    (prefill?: {
      assetId?: string;
      description?: string;
      concernType?: SupervisorConcernType;
    }) => {
      setSelectedReviewId(null);
      setRaiseError(null);
      setRaiseDescription(prefill?.description?.trim() ?? "");
      setRaiseConcernType(prefill?.concernType ?? "equipment");
      setAssetSearch("");
      setTaggedWorkerIds(new Set());
      if (prefill?.assetId && assetOptions.some((a) => a.id === prefill.assetId)) {
        setRaiseAssetId(prefill.assetId);
      } else if (assetOptions.length) {
        setRaiseAssetId((current) =>
          current && assetOptions.some((a) => a.id === current)
            ? current
            : assetOptions[0].id,
        );
      }
      setRaiseOpen(true);
    },
    [assetOptions],
  );

  const closeReportPanel = useCallback(() => {
    setRaiseOpen(false);
    setRaiseError(null);
  }, []);

  const selectReview = useCallback((reviewId: string) => {
    setRaiseOpen(false);
    setSelectedReviewId(reviewId);
  }, []);

  const closeRightPanel = useCallback(() => {
    closeReportPanel();
    closeDrawer();
  }, [closeReportPanel, closeDrawer]);

  useEffect(() => {
    if (!bootstrapped) {
      void bootstrap();
    }
  }, [bootstrapped, bootstrap]);

  async function refreshBoard() {
    if (!actor || actor.kind !== "worker") return;
    setLoading(true);
    setError(null);
    try {
      const [items, shared, raised, zone] = await Promise.all([
        fetchTasks(actor.id),
        fetchSharedReviews(),
        fetchRaisedReviews(),
        fetchZoneReviews(),
      ]);
      setTasks(items);
      setSharedReviews(shared);
      setRaisedReviews(raised);
      setZoneReviews(zone);
      setSelectedReviewId((current) => {
        if (!current) return null;
        const stillVisible =
          items.some((t) => t.review_id === current) ||
          shared.some((s) => s.review_id === current) ||
          raised.some((s) => s.review_id === current) ||
          zone.some((s) => s.review_id === current);
        return stillVisible ? current : null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor?.id, taskEventSeq, boardEventSeq]);

  useEffect(() => {
    const reviewFromUrl = new URLSearchParams(window.location.search).get(
      "review",
    );
    if (reviewFromUrl) setSelectedReviewId(reviewFromUrl);
  }, []);

  useEffect(() => {
    if (!raiseOpen || filteredAssets.length === 0) return;
    if (
      !raiseAssetId ||
      !filteredAssets.some((asset) => asset.id === raiseAssetId)
    ) {
      setRaiseAssetId(filteredAssets[0].id);
    }
  }, [raiseOpen, filteredAssets, assetSearch, raiseAssetId]);

  useEffect(() => {
    if (!actor || actor.kind !== "worker") return;
    setAssetsLoading(true);
    void fetchAssets()
      .then((all) => {
        const scoped = all.filter((a) => actor.owned_zones.includes(a.zone));
        setAssetOptions(scoped);
        setRaiseAssetId((current) => {
          if (current && scoped.some((a) => a.id === current)) return current;
          return scoped[0]?.id ?? null;
        });
      })
      .catch((e) => {
        setRaiseError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setAssetsLoading(false));

    void fetchRoster()
      .then((roster) => {
        setWorkerRoster(roster.filter((r) => r.kind === "worker"));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor?.id]);

  useEffect(() => {
    if (!selectedReviewId && !raiseOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeRightPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedReviewId, raiseOpen, closeRightPanel]);

  const taskReviewIds = useMemo(
    () => new Set(tasks.map((t) => t.review_id)),
    [tasks],
  );

  const sharedOpen = useMemo(
    () => sharedReviews.filter((s) => !taskReviewIds.has(s.review_id)),
    [sharedReviews, taskReviewIds],
  );

  const raisedOpen = useMemo(
    () =>
      raisedReviews.filter(
        (r) =>
          !taskReviewIds.has(r.review_id) &&
          !sharedOpen.some((s) => s.review_id === r.review_id),
      ),
    [raisedReviews, taskReviewIds, sharedOpen],
  );

  const zoneOpen = useMemo(() => {
    const covered = new Set([
      ...taskReviewIds,
      ...sharedOpen.map((s) => s.review_id),
      ...raisedOpen.map((r) => r.review_id),
    ]);
    return zoneReviews.filter((z) => !covered.has(z.review_id));
  }, [zoneReviews, taskReviewIds, sharedOpen, raisedOpen]);

  const groups = useMemo(() => {
    return {
      open: tasks.filter((t) => t.status === "open"),
      acknowledged: tasks.filter((t) => t.status === "acknowledged"),
      done: tasks.filter((t) => t.status === "done"),
    };
  }, [tasks]);

  if (!actor || actor.kind !== "worker") {
    return (
      <div className={styles.gate}>
        <p>Supervisor view requires a supervisor identity.</p>
        <p>
          Go to <Link href="/login">login</Link>.
        </p>
      </div>
    );
  }

  const rightPanelOpen = raiseOpen || Boolean(selectedReviewId);
  const showEmptyBoard =
    tasks.length === 0 &&
    sharedReviews.length === 0 &&
    raisedReviews.length === 0 &&
    zoneReviews.length === 0;
  const openCount =
    groups.open.length +
    sharedOpen.length +
    raisedOpen.length +
    zoneOpen.length;

  function renderReportCard(
    item: SharedReview,
    badge: string,
    badgeClass: string,
    metaPrefix?: string,
  ) {
    const active = selectedReviewId === item.review_id;
    const stage = lifecycleForReportCard(item, tasks);
    const canRaiseAgain =
      badge === "Reported" &&
      (item.review_state === "decided" || item.review_state === "closed");
    return (
      <li
        key={`${badge}-${item.review_id}`}
        className={styles.task}
        data-active={active ? "true" : "false"}
        data-shared={badge === "Shared" ? "true" : undefined}
        data-reported={badge === "Reported" ? "true" : undefined}
        data-zone={badge === "Zone" ? "true" : undefined}
      >
        <button
          type="button"
          className={styles.taskSelect}
          onClick={() => selectReview(item.review_id)}
        >
          <div className={styles.taskTitleRow}>
            <h3 className={styles.taskTitle}>{item.asset_name}</h3>
            <span className={`badge ${badgeClass}`}>{badge}</span>
          </div>
          <div className={styles.chipRow}>
            <span
              className={styles.stageChip}
              data-stage={stage.toLowerCase().replaceAll(" ", "-")}
            >
              {stage}
            </span>
            <span className={styles.concernChip}>
              {labelSupervisorConcern(item.concern_type)}
            </span>
          </div>
          <p className={styles.taskMeta}>{item.asset_zone}</p>
          {metaPrefix ? (
            <p className={styles.taskMeta}>{metaPrefix}</p>
          ) : null}
          <p className={styles.sharedPreview}>{item.description}</p>
        </button>
        {canRaiseAgain ? (
          <div className={styles.taskActions}>
            <button
              type="button"
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                openReportPanel({
                  assetId: item.asset_id,
                  description: item.description,
                  concernType: item.concern_type as SupervisorConcernType,
                });
              }}
            >
              Raise again
            </button>
          </div>
        ) : null}
      </li>
    );
  }

  function renderSharedCard(item: SharedReview) {
    return renderReportCard(
      item,
      "Shared",
      styles.sharedBadge,
      `From ${item.raised_by_name}`,
    );
  }

  function renderRaisedCard(item: SharedReview) {
    return renderReportCard(item, "Reported", styles.reportedBadge);
  }

  function renderZoneCard(item: SharedReview) {
    return renderReportCard(
      item,
      "Zone",
      styles.zoneBadge,
      item.origin === "system" ? "From live signals" : `From ${item.raised_by_name}`,
    );
  }

  return (
    <div className={styles.wrap}>
      <div
        className={styles.stage}
        data-drawer-open={rightPanelOpen ? "true" : undefined}
      >
        <section className={styles.mainPanel} aria-label="Task board">
          <header className={styles.panelHeader}>
            <div className={styles.panelHeaderText}>
              <h1 className={styles.panelTitle}>My Dashboard</h1>
              <p className={styles.panelSubtitle}>
                Tasks and reviews for your assigned zones.
              </p>
              {zones.length > 0 ? (
                <div className={styles.zoneList} aria-label="Assigned zones">
                  {zones.map((zone) => (
                    <span key={zone} className={styles.zoneChip}>
                      {zone}
                    </span>
                  ))}
                </div>
              ) : (
                <p className={styles.panelSubtitle}>No zones assigned</p>
              )}
            </div>
            {!showEmptyBoard ? (
              <button
                type="button"
                className={`btn btn-primary ${styles.reportTrigger}`}
                data-active={raiseOpen ? "true" : "false"}
                onClick={() => openReportPanel()}
              >
                Report floor issue
              </button>
            ) : null}
          </header>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          {showEmptyBoard ? (
            <div className={styles.emptyState} role="status">
              <ListeningOrbit />
              <p className={styles.emptyTitle}>
                {loading ? "Loading tasks…" : "All clear in your zones"}
              </p>
              <p className={styles.emptyCopy}>
                {loading
                  ? "Checking for work assigned to your zones."
                  : "Open work in your zones, shared reports, and assigned tasks appear here. Report a floor issue if something needs operator attention."}
              </p>
              {!loading ? (
                <button
                  type="button"
                  className={`btn btn-primary ${styles.reportTrigger}`}
                  data-active={raiseOpen ? "true" : "false"}
                  onClick={() => openReportPanel()}
                >
                  Report floor issue
                </button>
              ) : null}
            </div>
          ) : (
            <div className={styles.board}>
              {COLUMNS.map(({ key, label }) => (
                <section key={key} className={styles.column} aria-label={label}>
                  <div className={styles.columnHeader}>
                    <h2 className={styles.columnTitle}>{label}</h2>
                    <span className={styles.columnCount}>
                      {key === "open" ? openCount : groups[key].length}
                    </span>
                  </div>
                  <ul className={styles.columnList}>
                    {key === "open" ? (
                      <>
                        {zoneOpen.map((item) => renderZoneCard(item))}
                        {raisedOpen.map((item) => renderRaisedCard(item))}
                        {sharedOpen.map((item) => renderSharedCard(item))}
                      </>
                    ) : null}
                    {groups[key].map((t) => {
                      const isBusy = busyTaskIds.has(t.id);
                      const active = selectedReviewId === t.review_id;
                      const stage = lifecycleLabelForReviewState(t.review_state);
                      return (
                        <li
                          key={t.id}
                          className={styles.task}
                          data-active={active ? "true" : "false"}
                        >
                          <button
                            type="button"
                            className={styles.taskSelect}
                            onClick={() => selectReview(t.review_id)}
                          >
                            <div className={styles.taskTitleRow}>
                              <h3 className={styles.taskTitle}>{t.title}</h3>
                              <span
                                className={styles.taskTypeChip}
                                data-type={t.task_type}
                              >
                                {taskTypeLabel(t.task_type)}
                              </span>
                            </div>
                            <div className={styles.chipRow}>
                              <span
                                className={styles.stageChip}
                                data-stage={stage
                                  .toLowerCase()
                                  .replaceAll(" ", "-")}
                              >
                                {stage}
                              </span>
                            </div>
                            <p className={styles.taskMeta}>
                              {t.asset_name} · {t.asset_zone}
                            </p>
                            {t.decision_outcome ? (
                              <p className={styles.taskOutcome}>
                                Outcome:{" "}
                                <strong>
                                  {t.decision_outcome.replaceAll("_", " ")}
                                </strong>
                              </p>
                            ) : null}
                          </button>

                          {t.status === "open" ? (
                            <div className={styles.taskActions}>
                              <button
                                type="button"
                                className="btn"
                                disabled={isBusy}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setBusyTaskIds(
                                    (prev) => new Set([...prev, t.id]),
                                  );
                                  try {
                                    await postAcknowledgeTask(t.id);
                                    await refreshBoard();
                                  } finally {
                                    setBusyTaskIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(t.id);
                                      return next;
                                    });
                                  }
                                }}
                              >
                                {isBusy ? "…" : "Acknowledge"}
                              </button>
                            </div>
                          ) : null}

                          {t.status === "acknowledged" ? (
                            <div className={styles.taskActions}>
                              <textarea
                                className={styles.doneNote}
                                value={doneNotes[t.id] ?? ""}
                                onChange={(e) => {
                                  setDoneNotes({
                                    ...doneNotes,
                                    [t.id]: e.target.value,
                                  });
                                }}
                                rows={2}
                                placeholder="Done note (what you did / evidence)"
                              />
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={isBusy}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  setBusyTaskIds(
                                    (prev) => new Set([...prev, t.id]),
                                  );
                                  try {
                                    await postDoneTask(t.id, {
                                      done_note: doneNotes[t.id] ?? "",
                                    });
                                    await refreshBoard();
                                  } finally {
                                    setBusyTaskIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(t.id);
                                      return next;
                                    });
                                  }
                                }}
                              >
                                {isBusy ? "…" : "Mark done"}
                              </button>
                            </div>
                          ) : null}

                          {t.status === "done" ? (
                            <p className={styles.doneSummary}>
                              Done:{" "}
                              <strong>{t.done_note ? t.done_note : "—"}</strong>
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                    {(key === "open" ? openCount : groups[key].length) ===
                    0 ? (
                      <li className={styles.columnEmpty} role="status">
                        <ListeningOrbit compact />
                        <p className={styles.emptyTitle}>Nothing in {label}</p>
                        <p className={styles.emptyCopy}>
                          Work will appear as tasks move into this stage.
                        </p>
                      </li>
                    ) : null}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>

      {rightPanelOpen ? (
        <aside
          className={styles.drawer}
          data-mode={raiseOpen ? "report" : "review"}
          aria-label={raiseOpen ? "Report floor issue" : "Task details"}
        >
          {raiseOpen ? (
            <>
              <header className={styles.drawerHeader}>
                <div className={styles.drawerTitleBlock}>
                  <h2 id="raise-issue-title" className={styles.drawerTitle}>
                    Report floor issue
                  </h2>
                  <p className={styles.drawerMeta}>
                    Sent to the operator for assessment. Tag other supervisors
                    if they should follow along.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.drawerClose}
                  aria-label="Close report form"
                  onClick={closeReportPanel}
                >
                  ×
                </button>
              </header>

              <div className={styles.drawerBody}>
                {raiseError ? (
                  <p className={styles.reportError} role="alert">
                    {raiseError}
                  </p>
                ) : null}

                <div className={styles.reportForm}>
                  <section className={styles.reportSection}>
                    <span className={styles.fieldLabel}>Asset in your zone</span>
                    {assetsLoading ? (
                      <p className={styles.reportHint}>Loading assets…</p>
                    ) : assetOptions.length === 0 ? (
                      <p className={styles.reportHint}>
                        No assets are mapped to your assigned zones yet.
                      </p>
                    ) : (
                      <>
                        <input
                          type="search"
                          className={styles.fieldControl}
                          value={assetSearch}
                          onChange={(e) => setAssetSearch(e.target.value)}
                          placeholder="Filter by asset or zone"
                        />
                        <select
                          className={styles.fieldControl}
                          value={raiseAssetId ?? ""}
                          onChange={(e) => setRaiseAssetId(e.target.value)}
                          aria-label="Select asset"
                        >
                          {[...assetsByZone.entries()].map(([zone, assets]) => (
                            <optgroup key={zone} label={zone}>
                              {assets.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {filteredAssets.length === 0 ? (
                          <p className={styles.reportHint}>
                            No assets match your search.
                          </p>
                        ) : selectedRaiseAsset ? (
                          <p className={styles.fieldHint}>
                            {selectedRaiseAsset.name} · {selectedRaiseAsset.zone}
                          </p>
                        ) : null}
                      </>
                    )}
                  </section>

                  <section className={styles.reportSection}>
                    <span className={styles.fieldLabel}>Type of concern</span>
                    <ul
                      className={styles.concernList}
                      aria-label="Type of concern"
                    >
                      {SUPERVISOR_CONCERN_OPTIONS.map((option) => {
                        const active = raiseConcernType === option.value;
                        return (
                          <li key={option.value}>
                            <button
                              type="button"
                              className={styles.concernOption}
                              data-active={active ? "true" : "false"}
                              data-risk={
                                option.value === "safety_hazard"
                                  ? "blocking"
                                  : "elevated"
                              }
                              onClick={() => setRaiseConcernType(option.value)}
                            >
                              <span className={styles.concernLabel}>
                                {option.label}
                              </span>
                              <span className={styles.concernHint}>
                                {option.hint}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>

                  <label className={styles.reportSection}>
                    <span className={styles.fieldLabel}>
                      What did you observe?
                    </span>
                    <textarea
                      className={`${styles.fieldControl} ${styles.textarea}`}
                      value={raiseDescription}
                      onChange={(e) => setRaiseDescription(e.target.value)}
                      rows={5}
                      placeholder="Describe what you saw, heard, or measured on the floor."
                    />
                  </label>

                  <section className={styles.reportSection}>
                    <span className={styles.fieldLabel}>
                      Tag supervisors (optional)
                    </span>
                    <p className={styles.fieldHint}>
                      Tagged people get a notification and can open the issue
                      from their dashboard.
                    </p>
                    {tagOptions.length === 0 ? (
                      <p className={styles.reportHint}>
                        No other supervisors found.
                      </p>
                    ) : (
                      <ul
                        className={styles.tagList}
                        aria-label="Tag supervisors"
                      >
                        {tagOptions.map((worker) => {
                          const checked = taggedWorkerIds.has(worker.id);
                          return (
                            <li key={worker.id}>
                              <label className={styles.tagRow}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setTaggedWorkerIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(worker.id)) {
                                        next.delete(worker.id);
                                      } else {
                                        next.add(worker.id);
                                      }
                                      return next;
                                    });
                                  }}
                                />
                                <span className={styles.tagName}>
                                  {worker.name}
                                  <span className={styles.tagRole}>
                                    {" "}
                                    · {worker.role}
                                  </span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                </div>
              </div>

              <footer className={styles.reportFooter}>
                <button
                  type="button"
                  className="btn"
                  onClick={closeReportPanel}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    raiseBusy ||
                    assetsLoading ||
                    !raiseAssetId ||
                    !raiseDescription.trim()
                  }
                  onClick={async () => {
                    if (!actor || actor.kind !== "worker") return;
                    if (!raiseAssetId) return;
                    setRaiseBusy(true);
                    setRaiseError(null);
                    const tagCount = taggedWorkerIds.size;
                    try {
                      await postSupervisorReport({
                        asset_id: raiseAssetId,
                        triggered_by: "supervisor_reported",
                        description: raiseDescription.trim(),
                        concern_type: raiseConcernType,
                        raised_by_worker_id: actor.id,
                        tagged_worker_ids: Array.from(taggedWorkerIds),
                      });
                      closeReportPanel();
                      setRaiseDescription("");
                      setTaggedWorkerIds(new Set());
                      toast.success(
                        tagCount
                          ? `Issue sent to the operator. ${tagCount} supervisor${tagCount === 1 ? "" : "s"} tagged.`
                          : "Issue sent to the operator console. Assessment is running.",
                      );
                      await refreshBoard();
                    } catch (e) {
                      setRaiseError(
                        e instanceof Error ? e.message : String(e),
                      );
                    } finally {
                      setRaiseBusy(false);
                    }
                  }}
                >
                  {raiseBusy ? "Sending…" : "Send to operator"}
                </button>
              </footer>
            </>
          ) : selectedReviewId ? (
            <>
              <header className={styles.drawerHeader}>
                <div className={styles.drawerTitleBlock}>
                  <h2 className={styles.drawerTitle}>
                    {selectedTask?.title ??
                      selectedRaised?.asset_name ??
                      selectedShared?.asset_name ??
                      "Review details"}
                  </h2>
                  {selectedTask ? (
                    <p className={styles.drawerMeta}>
                      {selectedTask.asset_name} · {selectedTask.asset_zone}
                    </p>
                  ) : selectedRaised ? (
                    <p className={styles.drawerMeta}>
                      {selectedRaised.asset_name} · {selectedRaised.asset_zone}{" "}
                      · {labelSupervisorConcern(selectedRaised.concern_type)} ·{" "}
                      {String(selectedRaised.review_state).replaceAll("_", " ")}
                    </p>
                  ) : selectedShared ? (
                    <p className={styles.drawerMeta}>
                      {selectedShared.asset_name} · {selectedShared.asset_zone}{" "}
                      · shared by {selectedShared.raised_by_name}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={styles.drawerClose}
                  aria-label="Close details"
                  onClick={closeDrawer}
                >
                  ×
                </button>
              </header>
              <div className={styles.drawerBody}>
                <ReviewDetail reviewId={selectedReviewId} variant="embedded" />
              </div>
            </>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
