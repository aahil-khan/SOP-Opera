"use client";

import { useEffect, useState } from "react";
import { fetchPing, getFixtureAssessment, getFixtureReferences } from "@/lib/api";
import { useWsEcho } from "@/hooks/useWsEcho";
import type { PingResponse } from "@/shared/api_contracts";
import styles from "./page.module.css";

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
    <div className={styles.page}>
      <header>
        <p className={styles.eyebrow}>Dev</p>
        <h1 className={styles.title}>Phase 0 seam check</h1>
        <p className={styles.subtitle}>
          Shared contracts, REST ping, WebSocket echo, fixtures.
        </p>
      </header>

      <section className="panel">
        <h2 className={styles.sectionTitle}>REST · GET /api/ping</h2>
        {pingError && (
          <p className={styles.error}>
            {pingError} — is the FastAPI server running on :8000?
          </p>
        )}
        {ping && (
          <p className={styles.ok}>
            <code>{ping.service}</code>: {ping.message}
          </p>
        )}
        {!ping && !pingError && <p className={styles.muted}>Loading…</p>}
      </section>

      <section className="panel">
        <h2 className={styles.sectionTitle}>WebSocket · /ws echo</h2>
        <p className={styles.mutedSpaced}>
          Status: <code>{status}</code>
        </p>
        {lastEcho && (
          <p className={styles.ok}>
            Echo: <code>{lastEcho}</code>
          </p>
        )}
      </section>

      <section className="panel">
        <h2 className={styles.sectionTitle}>Fixtures · shared contracts</h2>
        <p className={styles.mutedSpaced}>
          Assessment risk: <code>{assessment.risk_level}</code> · retrieval:{" "}
          <code>{assessment.metadata?.retrieval_mode}</code>
        </p>
        <ul className={styles.refList}>
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
