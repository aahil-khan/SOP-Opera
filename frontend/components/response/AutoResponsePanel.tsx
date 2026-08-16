"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResponseAction } from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import {
  armProgress,
  assurance,
  canAbort,
  canRevoke,
  equipmentLabel,
  equipmentState,
  formatClock,
  groupByIntent,
  headline,
  pageStatus,
  plainState,
  secondsRemaining,
  secondsSinceDispatch,
} from "@/lib/autoResponse";
import { EnvelopeExplainer } from "./EnvelopeExplainer";
import styles from "./AutoResponsePanel.module.css";

/**
 * Auto response — what the system did without being asked.
 *
 * Built to be understood by scanning. The four section headings are the whole
 * story: made the area safe · warned people · kept a record · never without a
 * person. A reader who never opens a row still learns what happened and where
 * the automation stops.
 *
 * Scoped to one review. It lives beside the assessment it belongs to, so the
 * count answers "what did the system do about *this*" rather than summing
 * every zone in the plant — which made the number climb on its own as ambient
 * telemetry opened unrelated reviews, and duplicated every row per zone.
 */
export function AutoResponsePanel({ reviewId }: { reviewId?: string }) {
  const allActions = useLiveStore((s) => s.responseActions);
  const actions = useMemo(
    () =>
      reviewId
        ? allActions.filter((a) => a.review_id === reviewId)
        : allActions,
    [allActions, reviewId],
  );
  const armWindow = useLiveStore((s) => s.responseArmWindowSeconds);
  const autoEnabled = useLiveStore((s) => s.responseAutoEnabled);
  const setResponseAuto = useLiveStore((s) => s.setResponseAuto);
  const abortResponse = useLiveStore((s) => s.abortResponse);
  const revokeResponse = useLiveStore((s) => s.revokeResponse);
  const ackResponsePage = useLiveStore((s) => s.ackResponsePage);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showNever, setShowNever] = useState(false);

  const groups = useMemo(() => groupByIntent(actions), [actions]);
  const counting = actions.some((a) => a.status === "armed");

  // The clock exists only while something is counting down.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [counting]);

  const assetName =
    actions.find((a) => a.asset_name)?.asset_name ?? null;
  const { count, where } = headline(actions, assetName);
  const assured = useMemo(() => assurance(actions), [actions]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  };

  if (actions.length === 0) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>
          Nothing is running automatically.
          <span className={styles.emptyHint}>
            When a hazard appears, what the system does about it shows up here.
          </span>
        </p>
        <p className={styles.footnote}>Simulated equipment</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.headline}>
        <p className={styles.count}>
          <strong>{count}</strong> automatic {count === 1 ? "action" : "actions"}
        </p>
        {/* The safety argument, on screen by default. See assurance(). */}
        {assured.allReversible ? (
          <p className={styles.assurance}>
            Every one can be undone
            {assured.refused > 0
              ? ` · ${assured.refused} refused as too far-reaching`
              : ""}
          </p>
        ) : null}
        {where ? <p className={styles.where}>{where}</p> : null}
        <button
          type="button"
          className={styles.pause}
          data-paused={!autoEnabled ? "true" : undefined}
          onClick={() => void setResponseAuto(!autoEnabled)}
          aria-pressed={!autoEnabled}
        >
          {autoEnabled ? "Pause" : "Resume"}
        </button>
      </div>

      {!autoEnabled ? (
        <p className={styles.pausedNote}>
          Paused — nothing new will act on its own.
        </p>
      ) : null}

      <div className={styles.scroll}>
        {groups.map((group) =>
          group.tier === 3 ? (
            <section key={group.id} className={styles.group} data-never="true">
              <button
                type="button"
                className={styles.groupToggle}
                onClick={() => setShowNever((v) => !v)}
                aria-expanded={showNever}
              >
                <span className={styles.groupTitle}>{group.title}</span>
                <span className={styles.groupCount}>{group.actions.length}</span>
                <span className={styles.chevron} data-open={showNever}>
                  ⌄
                </span>
              </button>
              {/* Named even while collapsed: the boundary is the point, and it
                  should land without needing a click. */}
              <p className={styles.neverList}>
                {group.actions.map((a) => a.label).join(" · ")}
              </p>
              {showNever ? (
                <ul className={styles.list}>
                  {group.actions.map((a) => (
                    <li key={a.id} className={styles.neverRow}>
                      <span className={styles.neverName}>{a.label}</span>
                      <span className={styles.neverWhy}>{a.refusal_reason}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : (
            <section key={group.id} className={styles.group}>
              <div className={styles.groupHead}>
                <h3 className={styles.groupTitle}>{group.title}</h3>
                <span className={styles.groupCount}>{group.actions.length}</span>
              </div>
              <ul className={styles.list}>
                {group.actions.map((a) => (
                  <ActionRow
                    key={a.id}
                    action={a}
                    now={now}
                    armWindow={armWindow}
                    open={openId === a.id}
                    busy={busyId === a.id}
                    busyId={busyId}
                    onToggle={() => setOpenId(openId === a.id ? null : a.id)}
                    onStop={() => void run(a.id, () => abortResponse(a.id))}
                    onUndo={() =>
                      void run(a.id, () =>
                        revokeResponse(a.id, "Undone from Auto response"),
                      )
                    }
                    onAck={(pageId) =>
                      void run(pageId, () => ackResponsePage(pageId))
                    }
                  />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>

      <p className={styles.footnote}>Simulated equipment</p>
    </div>
  );
}

function ActionRow({
  action,
  now,
  armWindow,
  open,
  busy,
  busyId,
  onToggle,
  onStop,
  onUndo,
  onAck,
}: {
  action: ResponseAction;
  now: number;
  armWindow: number;
  open: boolean;
  busy: boolean;
  busyId: string | null;
  onToggle: () => void;
  onStop: () => void;
  onUndo: () => void;
  onAck: (pageId: string) => void;
}) {
  const starting = action.status === "armed";
  const secs = secondsRemaining(action, now);
  const state = plainState(equipmentState(action));
  const page = pageStatus(action);

  return (
    <li className={styles.row} data-tier={action.tier} data-starting={starting}>
      {starting ? (
        <span
          className={styles.armBar}
          style={{ width: `${armProgress(action, armWindow, now) * 100}%` }}
          aria-hidden="true"
          data-urgent={secs !== null && secs <= 3 ? "true" : undefined}
        />
      ) : null}

      <button
        type="button"
        className={styles.name}
        onClick={onToggle}
        aria-expanded={open}
        title="Why the system was allowed to do this"
      >
        {equipmentLabel(action)}
      </button>

      <span className={styles.state} data-kind={stateKind(action, page)}>
        {starting
          ? `starts in ${secs ?? 0}s`
          : state
            ? state
            : page.kind === "answered"
              ? "answered"
              : page.kind === "waiting"
                ? `no reply ${formatClock(
                    secondsSinceDispatch(page.since, now) ?? 0,
                  )}`
                : page.kind === "unanswered"
                  ? "no answer"
                  : "saved"}
      </span>

      {starting && canAbort(action) ? (
        <button
          type="button"
          className={styles.action}
          disabled={busy}
          onClick={onStop}
        >
          Stop
        </button>
      ) : canRevoke(action) ? (
        <button
          type="button"
          className={styles.action}
          disabled={busy}
          onClick={onUndo}
        >
          Undo
        </button>
      ) : (
        <span className={styles.actionSpacer} />
      )}

      {page.kind === "waiting" ? (
        <div className={styles.pageLine}>
          <span className={styles.pageWho}>
            {page.role} · {page.channel}
          </span>
          <button
            type="button"
            className={styles.action}
            disabled={busyId === page.pageId}
            onClick={() => onAck(page.pageId)}
          >
            Acknowledge
          </button>
        </div>
      ) : page.kind === "unanswered" ? (
        <p className={styles.pageAlert}>
          Nobody acknowledged after {page.tried}{" "}
          {page.tried === 1 ? "attempt" : "attempts"}. Send someone to the zone.
        </p>
      ) : null}

      {open ? (
        <div className={styles.detail}>
          <EnvelopeExplainer envelope={action.envelope} />
        </div>
      ) : null}
    </li>
  );
}

/** Colour cue for the state word: normal, good, or a problem. */
function stateKind(
  action: ResponseAction,
  page: ReturnType<typeof pageStatus>,
): "normal" | "ok" | "warn" | "bad" {
  if (action.status === "armed") return "warn";
  if (page.kind === "answered") return "ok";
  if (page.kind === "waiting") return "warn";
  if (page.kind === "unanswered") return "bad";
  return "normal";
}
