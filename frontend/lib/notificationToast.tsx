"use client";

import Link from "next/link";
import { toast, type TypeOptions } from "react-toastify";
import type { Notification } from "@/shared/schemas";
import { getActorFromCookie } from "@/lib/actorCookie";
import { isDndEnabled } from "@/lib/dndMode";
import {
  notificationOpenHref,
  notificationToastId,
  presentNotification,
  type NotificationSeverity,
} from "@/lib/notificationPresentation";
import styles from "@/components/notifications/AppToaster.module.css";

function toastType(severity: NotificationSeverity): TypeOptions {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

function autoCloseMs(
  n: Notification,
  severity: NotificationSeverity,
): number | false {
  if (n.event_type === "assessment.failed") return false;
  if (severity === "error") return 8000;
  if (severity === "warning") return 5000;
  return 4000;
}

function ToastBody({
  title,
  detail,
  href,
  onOpen,
  onDismiss,
}: {
  title: string;
  detail: string;
  href: string | null;
  onOpen?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className={styles.body}>
      <p className={styles.title}>{title}</p>
      {detail && detail !== title ? (
        <p className={styles.description}>{detail}</p>
      ) : null}
      <div className={styles.actions}>
        {href ? (
          <Link
            href={href}
            className={styles.action}
            onClick={() => {
              onOpen?.();
              onDismiss?.();
            }}
          >
            Open
          </Link>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            className={styles.cancel}
            onClick={onDismiss}
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Push an urgent domain notification through react-toastify (no-op if not toastable). */
export function showNotificationToast(
  n: Notification,
  options?: { onClear?: () => void; onOpen?: () => void },
): void {
  if (isDndEnabled()) return;
  const actor = getActorFromCookie();
  if (
    actor?.id != null &&
    !n.recipient_ids.includes(actor.id)
  ) {
    return;
  }
  const presentation = presentNotification(n);
  if (!presentation.toastable) return;

  const toastId = notificationToastId(n);
  const type = toastType(presentation.severity);
  const isCritical =
    n.event_type === "assessment.completed" &&
    /\bcritical\b/i.test(n.summary);
  const href = notificationOpenHref(n, actor?.kind);

  toast(
    <ToastBody
      title={presentation.title}
      detail={presentation.detail}
      href={href}
      onOpen={options?.onOpen}
      onDismiss={
        options?.onClear
          ? () => {
              options.onClear?.();
              toast.dismiss(toastId);
            }
          : undefined
      }
    />,
    {
      toastId,
      type,
      autoClose: autoCloseMs(n, presentation.severity),
      closeOnClick: false,
      className: isCritical ? styles.toastCritical : styles.toast,
    },
  );
}

export function dismissNotificationToast(n: Notification | string): void {
  if (typeof n === "string") {
    toast.dismiss(n);
    return;
  }
  toast.dismiss(notificationToastId(n));
}

export function dismissAllNotificationToasts(): void {
  toast.dismiss();
}

/** In-panel case worsened / new signals while a settled assessment existed. */
export function showReassessmentToast(options: {
  reviewId: string;
  previousState: string;
  onOpen?: () => void;
}): void {
  if (isDndEnabled()) return;
  const toastId = `reassess-${options.reviewId}`;
  const fromDecision = options.previousState === "pending_decision";
  if (!fromDecision && options.previousState !== "reopened") return;

  toast(
    <ToastBody
      title="Situation updated — reassessment started"
      detail="New signals arrived while this case was open. Hold any decision until the updated recommendation is ready."
      href={`/reviews/${options.reviewId}`}
      onOpen={options.onOpen}
      onDismiss={() => toast.dismiss(toastId)}
    />,
    {
      toastId,
      type: "warning",
      autoClose: 7000,
      closeOnClick: false,
      className: styles.toast,
    },
  );
}
