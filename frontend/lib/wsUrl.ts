/**
 * Resolve the realtime WebSocket endpoint.
 *
 * This exists because of a production defect worth remembering. The deployed
 * build had `NEXT_PUBLIC_WS_URL` set to the API base with no `/ws` path
 * (`https://sop-opera-api.aahil-khan.xyz`), so every handshake hit the domain
 * root and was refused with 403. `useRealtimeEvents` then reconnected on a
 * backoff capped at 10s, forever, with nothing user-visible to say so — the UI
 * only updated on fetch-on-mount, which read as "ingested context needs several
 * refreshes to appear".
 *
 * Two properties make that hard to repeat:
 *
 * 1. The URL is *derived* from the API base, so a correct deployment needs no
 *    second env var at all. `NEXT_PUBLIC_WS_URL` stays available as an override.
 * 2. An override is normalized rather than trusted: http/https are mapped onto
 *    ws/wss, and a bare origin gains the `/ws` path. Pasting the API base in —
 *    the exact mistake that shipped — now resolves correctly.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so a bad one survives until
 * the next redeploy. Deriving is cheaper than remembering that.
 */

const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const WS_PATH = "/ws";

export function resolveWsUrl(
  apiBase: string,
  override?: string | null,
): string {
  const candidate =
    (override ?? "").trim() || apiBase.trim() || DEFAULT_API_BASE;

  // A malformed override falls back to deriving from the API base, and only
  // then to the localhost default. Throwing here would happen at module load
  // and take the whole app down rather than just realtime.
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    try {
      url = new URL(apiBase.trim());
    } catch {
      url = new URL(DEFAULT_API_BASE);
    }
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    url = new URL(DEFAULT_API_BASE);
    url.protocol = "ws:";
  }

  // A bare origin is the copy-pasted-API-base case. An explicit path is
  // deliberate (e.g. a reverse proxy mounting the app under a prefix) and kept.
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = WS_PATH;
  }

  url.hash = "";
  return url.toString();
}
