"use client";

import { useEffect, useState } from "react";
import { fetchPing, getFixtureAssessment, getFixtureReferences } from "@/lib/api";
import { useWsEcho } from "@/hooks/useWsEcho";
import type { PingResponse } from "@/shared/api_contracts";

export default function DevSeamCheckPage() {
  const [ping, setPing] = useState<PingResponse | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const { status, lastEcho } = useWsEcho();

  const assessment = getFixtureAssessment();
  const refs = getFixtureReferences();

  useEffect(() => {
    fetchPing()
      .then(setPing)
      .catch((err: Error) => setPingError(err.message));
  }, []);

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "2rem 1.5rem",
        display: "grid",
        gap: "1.5rem",
      }}
    >
      <header>
        <p style={{ color: "var(--muted)", letterSpacing: "0.08em", margin: 0 }}>
          DEV
        </p>
        <h1 style={{ margin: "0.35rem 0", fontSize: "1.75rem", fontWeight: 600 }}>
          Phase 0 seam check
        </h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Shared contracts, REST ping, WebSocket echo, fixtures.
        </p>
      </header>

      <section className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>REST · GET /api/ping</h2>
        {pingError && (
          <p style={{ color: "#f07178" }}>
            {pingError} — is the FastAPI server running on :8000?
          </p>
        )}
        {ping && (
          <p style={{ color: "var(--ok)", margin: 0 }}>
            <code>{ping.service}</code>: {ping.message}
          </p>
        )}
        {!ping && !pingError && <p style={{ color: "var(--muted)" }}>Loading…</p>}
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>WebSocket · /ws echo</h2>
        <p style={{ margin: "0 0 0.5rem", color: "var(--muted)" }}>
          Status: <code>{status}</code>
        </p>
        {lastEcho && (
          <p style={{ margin: 0, color: "var(--ok)" }}>
            Echo: <code>{lastEcho}</code>
          </p>
        )}
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>
          Fixtures · shared contracts
        </h2>
        <p style={{ margin: "0 0 0.5rem" }}>
          Assessment risk: <code>{assessment.risk_level}</code> · retrieval:{" "}
          <code>{assessment.metadata?.retrieval_mode}</code>
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--muted)" }}>
          {refs.map((r) => (
            <li key={`${r.source}-${r.id}`}>
              {r.source} · path=<code>{r.retrieval_path}</code>
              {r.score != null ? <> · score=<code>{r.score}</code></> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
