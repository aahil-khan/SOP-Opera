import type { Actor } from "@/lib/authTypes";

const COOKIE_KEY = "sop_actor";

function readCookieValue(key: string): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === key) return rest.join("=");
  }
  return null;
}

function decodeCookieJson(rawValue: string): unknown {
  // Cookie value is url-encoded JSON.
  const decoded = decodeURIComponent(rawValue);
  return JSON.parse(decoded);
}

function isActor(x: unknown): x is Actor {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    (a.kind === "user" || a.kind === "worker") &&
    typeof a.name === "string" &&
    typeof a.role === "string" &&
    Array.isArray(a.owned_zones)
  );
}

export function getActorFromCookie(): Actor | null {
  try {
    const raw = readCookieValue(COOKIE_KEY);
    if (!raw) return null;
    const parsed = decodeCookieJson(raw);
    return isActor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

