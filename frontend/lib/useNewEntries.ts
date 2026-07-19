"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NEW_ENTRY_MS } from "./relativeTime";

type Listener = () => void;

/** Single shared 15s clock for relative-time / "new" badges across twin panels. */
let sharedNow = Date.now();
const listeners = new Set<Listener>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function ensureSharedClock() {
  if (intervalId != null) return;
  intervalId = setInterval(() => {
    sharedNow = Date.now();
    for (const listener of listeners) listener();
  }, 15_000);
}

function stopSharedClock() {
  if (intervalId == null) return;
  clearInterval(intervalId);
  intervalId = null;
}

function subscribeSharedNow(listener: Listener): () => void {
  listeners.add(listener);
  ensureSharedClock();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopSharedClock();
  };
}

/**
 * Tracks first-seen times for list keys. On initial mount, existing keys are
 * primed as already-seen (not highlighted). Keys that appear later stay "new"
 * for NEW_ENTRY_MS.
 *
 * All call sites share one 15s wall clock (no duplicate intervals). The clock
 * stops entirely when nothing mounts this hook.
 */
export function useNewEntries(ids: string[]): {
  isNew: (id: string) => boolean;
  now: number;
} {
  const seenRef = useRef<Map<string, number>>(new Map());
  const primedRef = useRef(false);
  const [now, setNow] = useState(() => sharedNow);
  const [rev, setRev] = useState(0);

  const idKey = ids.join("\0");

  useEffect(() => {
    const t = Date.now();
    sharedNow = t;
    if (!primedRef.current) {
      for (const id of ids) {
        seenRef.current.set(id, t - NEW_ENTRY_MS - 1);
      }
      primedRef.current = true;
      return;
    }
    let added = false;
    for (const id of ids) {
      if (!seenRef.current.has(id)) {
        seenRef.current.set(id, t);
        added = true;
      }
    }
    if (added) {
      setNow(t);
      setRev((r) => r + 1);
    }
  }, [idKey, ids]);

  useEffect(() => subscribeSharedNow(() => setNow(sharedNow)), []);

  const isNew = useMemo(() => {
    void rev;
    void now;
    return (id: string) => {
      const seen = seenRef.current.get(id);
      return seen != null && now - seen < NEW_ENTRY_MS;
    };
  }, [now, rev]);

  return { isNew, now };
}
