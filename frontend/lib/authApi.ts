import {
  actorRequestHeaders,
  clearActorCookie,
  setActorCookie,
} from "@/lib/actorCookie";
import { API_BASE } from "@/lib/api";
import type { Actor, ActorKind, RosterEntry } from "@/lib/authTypes";

const ROSTER_TTL_MS = 60_000;
let rosterCache: { at: number; data: RosterEntry[] } | null = null;
let rosterInflight: Promise<RosterEntry[]> | null = null;

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...actorRequestHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail =
        typeof body.detail === "string"
          ? body.detail
          : JSON.stringify(body.detail ?? body);
    } catch {
      /* ignore */
    }
    throw new Error(`${path} failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as T;
}

export async function fetchRoster(): Promise<RosterEntry[]> {
  const now = Date.now();
  if (rosterCache && now - rosterCache.at < ROSTER_TTL_MS) {
    return rosterCache.data;
  }
  if (rosterInflight) return rosterInflight;
  rosterInflight = request<RosterEntry[]>(`/auth/roster`, { method: "GET" })
    .then((data) => {
      rosterCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      rosterInflight = null;
    });
  return rosterInflight;
}

export function clearRosterCache(): void {
  rosterCache = null;
}

export async function loginAs(actor: Actor): Promise<void> {
  await request(`/auth/login`, {
    method: "POST",
    body: JSON.stringify({ actor_id: actor.id }),
  });
  // Mirror on the page origin — do not call /auth/me here; the API cookie may
  // not be readable from the UI origin until the next credentialed request.
  setActorCookie(actor);
  clearRosterCache();
}

export async function logout(): Promise<void> {
  try {
    await request(`/auth/logout`, { method: "POST" });
  } finally {
    clearActorCookie();
    clearRosterCache();
  }
}

export async function fetchMe(): Promise<Actor> {
  return request<Actor>(`/auth/me`, { method: "GET" });
}

export function actorKindLabel(kind: ActorKind): string {
  return kind === "user" ? "Operator" : "Supervisor";
}

