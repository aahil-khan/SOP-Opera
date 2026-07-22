import type { PingResponse } from "@/shared/api_contracts";
import type { Assessment, RetrievedReference } from "@/shared/schemas";
// Real files under frontend/shared (synced from repo root shared/ via scripts/sync-shared.mjs).
// Turbopack rejects symlinks and imports that point outside the Next.js project root.
import fixtures from "@/shared/fixtures.json";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:8000/ws";

export async function fetchPing(): Promise<PingResponse> {
  const res = await fetch(`${API_BASE}/api/ping`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ping failed: ${res.status}`);
  }
  return res.json();
}

export function getFixtureAssessment(): Assessment {
  return fixtures.assessment as Assessment;
}

export function getFixtureReferences(): RetrievedReference[] {
  return fixtures.retrieved_references as RetrievedReference[];
}

export { API_BASE, WS_URL };
