import { API_BASE } from "@/lib/api";
import type { Actor, ActorKind, RosterEntry } from "@/lib/authTypes";

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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
  return request<RosterEntry[]>(`/auth/roster`, { method: "GET" });
}

export async function loginAs(actorId: string): Promise<void> {
  await request(`/auth/login`, {
    method: "POST",
    body: JSON.stringify({ actor_id: actorId }),
  });
}

export async function logout(): Promise<void> {
  await request(`/auth/logout`, { method: "POST" });
}

export async function fetchMe(): Promise<Actor> {
  return request<Actor>(`/auth/me`, { method: "GET" });
}

export function actorKindLabel(kind: ActorKind): string {
  return kind === "user" ? "Operator" : "Supervisor";
}

