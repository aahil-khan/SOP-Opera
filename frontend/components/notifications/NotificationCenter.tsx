"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useLiveStore } from "@/lib/liveStore";
import styles from "./NotificationCenter.module.css";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const notifications = useLiveStore((s) => s.notifications);
  const unreadIds = useLiveStore((s) => s.unreadNotificationIds);
  const markRead = useLiveStore((s) => s.markNotificationsRead);
  const dismissNotification = useLiveStore((s) => s.dismissNotification);
  const clearNotifications = useLiveStore((s) => s.clearNotifications);

  const unreadCount = unreadIds.length;

  useEffect(() => {
    if (!open) return;
    markRead();
  }, [open, notifications.length, markRead]);

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
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
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
          aria-label="Notification center"
        >
          <header className={styles.header}>
            <h2 className={styles.title}>Notifications</h2>
            {notifications.length > 0 && (
              <button
                type="button"
                className={styles.clearAll}
                onClick={() => clearNotifications()}
              >
                Clear All
              </button>
            )}
          </header>

          {notifications.length === 0 ? (
            <p className={styles.empty}>No notifications</p>
          ) : (
            <ul className={styles.list}>
              {notifications.map((n) => {
                const unread = unreadIds.includes(n.id);
                return (
                  <li
                    key={n.id}
                    className={styles.item}
                    data-unread={unread ? "true" : undefined}
                  >
                    <div className={styles.body}>
                      <p className={styles.summary}>{n.summary}</p>
                      <div className={styles.meta}>
                        <span className={styles.type}>{n.event_type}</span>
                        <span>{relativeTime(n.created_at)}</span>
                        {n.review_id && (
                          <Link
                            href={`/reviews/${n.review_id}`}
                            className={styles.link}
                            onClick={() => setOpen(false)}
                          >
                            Open review
                          </Link>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.dismiss}
                      aria-label="Dismiss notification"
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
