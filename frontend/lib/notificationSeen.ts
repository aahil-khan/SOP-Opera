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

/**
 * Compare two ISO timestamps by instant rather than lexically. The API emits
 * `+00:00` offsets at microsecond precision (`…:16.844166+00:00`) while
 * Date#toISOString emits `Z` at millisecond precision (`…:16.844Z`); those two
 * forms do not sort against each other as strings.
 */
function isAfter(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a > b;
  return ta > tb;
}

/**
 * First-visit lookback. Mirrors the 12h shift window the carry-forward ledger
 * already uses (backend/app/handover/schemas.py:67, composer.py:50), so a first
 * login treats the shift you are taking over as unread and anything older as
 * history.
 */
const FIRST_VISIT_LOOKBACK_MS = 12 * 60 * 60 * 1000;

/** Newest created_at among notifications, or null if empty. */
export function latestNotificationCreatedAt(
  notifications: { created_at: string }[],
): string | null {
  let latest: string | null = null;
  for (const n of notifications) {
    if (!latest || isAfter(n.created_at, latest)) latest = n.created_at;
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
 * First visit for an actor seeds the watermark to the start of the shift window
 * so historical inbox rows do not flood the badge, while anything raised during
 * the shift you are taking over still counts as unread. Later logins restore
 * anything newer.
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

  // Seeding to the newest item made a first login structurally unable to have
  // unread — the watermark was always >= every item, so the badge could never
  // appear on the visit that matters most. Seed to the shift boundary instead.
  const stored = getNotificationSeenAt(actorId);
  const seenAt =
    stored ?? new Date(Date.now() - FIRST_VISIT_LOOKBACK_MS).toISOString();
  if (stored == null) setNotificationSeenAt(actorId, seenAt);

  return relevant.filter((n) => isAfter(n.created_at, seenAt)).map((n) => n.id);
}
