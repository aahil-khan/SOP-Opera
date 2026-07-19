"use client";

import { useCallback, useState } from "react";
import { fetchShiftHandover, type ShiftHandoverBrief } from "@/lib/liveApi";
import styles from "./ShiftHandoverView.module.css";

export function ShiftHandoverView() {
  const [brief, setBrief] = useState<ShiftHandoverBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(12);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchShiftHandover(hours);
      setBrief(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <p className={styles.aiMark}>Agentic</p>
          <h1 className={styles.title}>Shift Handover Brief</h1>
          <p className={styles.meta}>
            Generative safety brief from the last N hours of plant signals,
            derived facts, and open reviews.
          </p>
        </div>
        <div className={styles.controls}>
          <label className={styles.label}>
            Window (hours)
            <input
              className={styles.input}
              type="number"
              min={1}
              max={72}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 12)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={generate}
            disabled={loading}
          >
            {loading ? "Generating…" : "Generate brief"}
          </button>
        </div>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {brief && (
        <article className={styles.card}>
          <div className={styles.cardMeta}>
            <span>{brief.provider}</span>
            <span>{brief.model}</span>
            <span>{brief.signal_count} signals</span>
            <span>{brief.generated_at}</span>
          </div>
          <pre className={styles.brief}>{brief.brief}</pre>
          {brief.active_facts.length > 0 && (
            <div className={styles.facts}>
              <h2>Active facts</h2>
              <ul>
                {brief.active_facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </article>
      )}
    </div>
  );
}
