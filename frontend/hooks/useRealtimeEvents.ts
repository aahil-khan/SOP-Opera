"use client";

import { useEffect, useRef } from "react";
import { WS_URL } from "@/lib/api";
import type { WsEnvelope } from "@/shared/api_contracts";
import { useLiveStore } from "@/lib/liveStore";

/**
 * One WebSocket subscription that refreshes the live store on domain events.
 * Mount once near the app root (RealtimeProvider).
 */
export function useRealtimeEvents(enabled = true) {
  const handleRealtimeEvent = useLiveStore((s) => s.handleRealtimeEvent);
  const handleRef = useRef(handleRealtimeEvent);
  handleRef.current = handleRealtimeEvent;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsEnvelope<
            Record<string, unknown>
          >;
          if (msg.type === "echo") return;
          handleRef.current(msg.type, (msg.payload ?? {}) as Record<string, unknown>);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        const delay = Math.min(10_000, 500 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [enabled]);
}
