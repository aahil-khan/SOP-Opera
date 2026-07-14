"use client";

import { useEffect, useState } from "react";
import { WS_URL } from "@/lib/api";
import type { WsEnvelope } from "@/shared/api_contracts";

export function useWsEcho() {
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "error">(
    "idle",
  );
  const [lastEcho, setLastEcho] = useState<string | null>(null);

  useEffect(() => {
    setStatus("connecting");
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setStatus("open");
      ws.send("hello from next.js phase-0");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsEnvelope<{ echo: string }>;
        if (msg.type === "echo") {
          setLastEcho(msg.payload.echo);
        }
      } catch {
        setLastEcho(event.data);
      }
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus("idle");

    return () => ws.close();
  }, []);

  return { status, lastEcho };
}
