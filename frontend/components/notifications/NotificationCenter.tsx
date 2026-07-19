"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  focusReviewAssetOnTwin,
  useLiveStore,
} from "@/lib/liveStore";
import {
  isAlertNotification,
  presentNotification,
} from "@/lib/notificationPresentation";
import { relativeTime } from "@/lib/relativeTime";
import styles from "./NotificationCenter.module.css";

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const notifications = useLiveStore((s) => s.notifications);
  const unreadIds = useLiveStore((s) => s.unreadNotificationIds);
  const markRead = useLiveStore((s) => s.markNotificationsRead);
  const dismissNotification = useLiveStore((s) => s.dismissNotification);
  const clearNotifications = useLiveStore((s) => s.clearNotifications);

  const alerts = notifications.filter(isAlertNotification);
  const unreadCount = unreadIds.filter((id) =>
    alerts.some((n) => n.id === id),
  ).length;

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

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={
          unreadCount > 0 ? `Activity, ${unreadCount} unread` : "Activity"
        }
        aria-expanded={open}
        aria-controls={panelId}
        data-open={open ? "true" : undefined}
        data-unread={unreadCount > 0 ? "true" : undefined}
        onClick={() => setOpen((v) => !v)}
      >
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
            <h2 className={styles.title}>Activity</h2>
            {alerts.length > 0 && (
              <button
                type="button"
                className={styles.clearAll}
                onClick={() => clearNotifications()}
              >
                Clear all
              </button>
            )}
          </header>

          {alerts.length === 0 ? (
            <p className={styles.empty}>No recent alerts</p>
          ) : (
            <ul className={styles.list}>
              {alerts.map((n) => {
                const unread = unreadIds.includes(n.id);
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
                          href="/"
                          className={styles.link}
                          onClick={() => {
                            setOpen(false);
                            dismissNotification(n.id);
                            void focusReviewAssetOnTwin(n.review_id!);
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
