/** Persist a per-actor watermark so unread survives refresh / re-login. */

const STORAGE_PREFIX = "sop-notif-seen:";

function storageKey(actorId: string | null): string {
  return `${STORAGE_PREFIX}${actorId ?? "anon"}`;
}

function storage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

export function getNotificationSeenAt(actorId: string | null): string | null {
  return storage()?.getItem(storageKey(actorId)) ?? null;
}

export function setNotificationSeenAt(
  actorId: string | null,
  iso: string,
): void {
  try {
    storage()?.setItem(storageKey(actorId), iso);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Newest created_at among notifications, or null if empty. */
export function latestNotificationCreatedAt(
  notifications: { created_at: string }[],
): string | null {
  let latest: string | null = null;
  for (const n of notifications) {
    if (!latest || n.created_at > latest) latest = n.created_at;
  }
  return latest;
}

type SeenNotification = {
  id: string;
  created_at: string;
  recipient_ids: string[];
};

/**
 * Inbox items newer than the last-seen watermark.
 * First visit for an actor seeds the watermark to the latest item so historical
 * inbox rows do not flood the badge; later logins restore anything newer.
 */
export function unreadIdsSinceSeen(
  notifications: SeenNotification[],
  actorId: string | null,
  isInbox: (n: SeenNotification) => boolean,
): string[] {
  const relevant = notifications.filter((n) => {
    if (!isInbox(n)) return false;
    if (actorId != null && !n.recipient_ids.includes(actorId)) return false;
    return true;
  });

  const seenAt = getNotificationSeenAt(actorId);
  if (seenAt == null) {
    const latest = latestNotificationCreatedAt(relevant);
    if (latest) setNotificationSeenAt(actorId, latest);
    return [];
  }

  return relevant.filter((n) => n.created_at > seenAt).map((n) => n.id);
}
