import { toast } from "sonner";
import type { Notification } from "@/shared/schemas";

/** Push a live domain notification through Sonner. */
export function showNotificationToast(
  n: Notification,
  options?: { onClear?: () => void },
): void {
  toast(n.summary, {
    id: n.id,
    description: n.event_type.replace(/[._]/g, " "),
    duration: 5600,
    action: n.review_id
      ? {
          label: "Open",
          onClick: () => {
            window.location.assign(`/reviews/${n.review_id}`);
          },
        }
      : undefined,
    cancel: options?.onClear
      ? {
          label: "Clear",
          onClick: () => options.onClear?.(),
        }
      : undefined,
  });
}

export function dismissNotificationToast(id: string): void {
  toast.dismiss(id);
}

export function dismissAllNotificationToasts(): void {
  toast.dismiss();
}
