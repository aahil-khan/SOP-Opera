"use client";

import { create } from "zustand";

const STORAGE_KEY = "sop-dnd-enabled";

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStored(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    /* ignore quota / private mode */
  }
}

interface DndState {
  enabled: boolean;
  hydrated: boolean;
  hydrate: () => void;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

export const useDndMode = create<DndState>((set, get) => ({
  enabled: false,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ enabled: readStored(), hydrated: true });
  },
  setEnabled: (enabled) => {
    writeStored(enabled);
    set({ enabled, hydrated: true });
  },
  toggle: () => get().setEnabled(!get().enabled),
}));

/** Non-React callers (toasts, chimes, live store). */
export function isDndEnabled(): boolean {
  return useDndMode.getState().enabled;
}
