"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useDndMode } from "@/lib/dndMode";
import { getActorFromCookie } from "@/lib/actorCookie";
import {
  focusReviewAssetOnTwin,
  useLiveStore,
} from "@/lib/liveStore";
import { dismissAllNotificationToasts } from "@/lib/notificationToast";
import {
  isAlertNotification,
  presentNotification,
} from "@/lib/notificationPresentation";
import type { Notification } from "@/shared/schemas";
import { relativeTime } from "@/lib/relativeTime";
import styles from "./NotificationCenter.module.css";

const EMPTY_NOTIFICATIONS: Notification[] = [];
const EMPTY_UNREAD_IDS: string[] = [];

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const actor = getActorFromCookie();
  const actorId = actor?.id ?? null;

  const dndEnabled = useDndMode((s) => s.enabled);
  const hydrateDnd = useDndMode((s) => s.hydrate);
  const setDndEnabled = useDndMode((s) => s.setEnabled);

  /** Number-stable: re-render only when badge count changes. */
  const unreadCount = useLiveStore((s) => {
    if (dndEnabled) return 0;
    const unread = new Set(s.unreadNotificationIds);
    let n = 0;
    for (const notif of s.notifications) {
      if (!unread.has(notif.id)) continue;
      if (actorId != null && !notif.recipient_ids.includes(actorId)) continue;
      if (isAlertNotification(notif)) n += 1;
    }
    return n;
  });

  /** Closed: skip list subscription so WS notification floods don't rebuild the trigger. */
  const notifications = useLiveStore((s) =>
    open ? s.notifications : EMPTY_NOTIFICATIONS,
  );
  const unreadIds = useLiveStore((s) =>
    open ? s.unreadNotificationIds : EMPTY_UNREAD_IDS,
  );
  const markRead = useLiveStore((s) => s.markNotificationsRead);
  const dismissNotification = useLiveStore((s) => s.dismissNotification);
  const clearNotifications = useLiveStore((s) => s.clearNotifications);

  const visibleNotifications =
    actorId != null
      ? notifications.filter((n) => n.recipient_ids.includes(actorId))
      : notifications;

  const alerts = visibleNotifications.filter(isAlertNotification);

  useEffect(() => {
    hydrateDnd();
  }, [hydrateDnd]);

  useEffect(() => {
    if (!open) return;
    markRead();
  }, [open, alerts.length, markRead]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleDnd = () => {
    const next = !dndEnabled;
    if (next) {
      dismissAllNotificationToasts();
      markRead();
    }
    setDndEnabled(next);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={
          dndEnabled
            ? "Activity, do not disturb on"
            : unreadCount > 0
              ? `Activity, ${unreadCount} unread`
              : "Activity"
        }
        aria-expanded={open}
        aria-controls={panelId}
        data-open={open ? "true" : undefined}
        data-unread={unreadCount > 0 ? "true" : undefined}
        data-dnd={dndEnabled ? "true" : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {dndEnabled ? (
          <svg
            className={styles.icon}
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M12 3a9 9 0 0 0-9 9v5.8L1 19v1h22v-1l-2-2.2V12a9 9 0 0 0-9-9Zm0 2a7 7 0 0 1 7 7v5.8l1 1.1H4l1-1.1V12a7 7 0 0 1 7-7Zm-1 3v6h2V8h-2Z"
            />
          </svg>
        ) : (
          <svg
            className={styles.icon}
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Zm7-5.2V11a7 7 0 1 0-14 0v5.8L3 19v1h18v-1l-2-2.2Z"
            />
          </svg>
        )}
        {unreadCount > 0 && (
          <span className={styles.badge}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className={styles.panel}
          role="dialog"
          aria-label="Activity"
        >
          <header className={styles.header}>
            <div className={styles.headerMain}>
              <h2 className={styles.title}>Activity</h2>
              {dndEnabled && (
                <span className={styles.dndStatus}>Do not disturb</span>
              )}
            </div>
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.dndToggle}
                data-active={dndEnabled ? "true" : undefined}
                aria-pressed={dndEnabled}
                onClick={toggleDnd}
              >
                {dndEnabled ? "DND on" : "DND off"}
              </button>
              {alerts.length > 0 && (
                <button
                  type="button"
                  className={styles.clearAll}
                  onClick={() => clearNotifications()}
                >
                  Clear all
                </button>
              )}
            </div>
          </header>

          {dndEnabled && (
            <p className={styles.dndHint}>
              Alerts are still logged here, but toasts, sounds, and badges are
              muted.
            </p>
          )}

          {alerts.length === 0 ? (
            <p className={styles.empty}>No recent alerts</p>
          ) : (
            <ul className={styles.list}>
              {alerts.map((n) => {
                const unread = !dndEnabled && unreadIds.includes(n.id);
                const presentation = presentNotification(n);
                return (
                  <li
                    key={n.id}
                    className={styles.item}
                    data-unread={unread ? "true" : undefined}
                    data-severity={presentation.severity}
                  >
                    <div className={styles.body}>
                      <div className={styles.row}>
                        <span
                          className={styles.label}
                          data-severity={presentation.severity}
                        >
                          {presentation.label}
                        </span>
                        <span className={styles.time}>
                          {relativeTime(n.created_at)}
                        </span>
                      </div>
                      <p className={styles.summary}>{presentation.detail}</p>
                      {n.review_id && (
                        <Link
                          href={
                            actor?.kind === "worker"
                              ? `/supervisor?review=${n.review_id}`
                              : "/operator"
                          }
                          className={styles.link}
                          onClick={() => {
                            setOpen(false);
                            dismissNotification(n.id);
                            if (actor?.kind !== "worker") {
                              void focusReviewAssetOnTwin(n.review_id!);
                            }
                          }}
                        >
                          Open
                        </Link>
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.dismiss}
                      aria-label="Dismiss"
                      onClick={() => dismissNotification(n.id)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
