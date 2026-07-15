"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchReports, type ReportSummary } from "@/lib/liveApi";
import styles from "./ReportsView.module.css";

export function ReportsView() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchReports()
      .then((data) => {
        if (!cancelled) {
          setReports(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.view}>
      <h1 className={styles.title}>Reports</h1>
      <p className={styles.meta}>
        One report is generated per review closure — Decision → Evidence → Report.
      </p>
      {loading && <p className={styles.empty}>Loading…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {!loading && !error && reports.length === 0 && (
        <p className={styles.empty}>No closure reports yet. Close a decided review to generate one.</p>
      )}
      <ul className={styles.list}>
        {reports.map((r) => (
          <li key={r.id}>
            <Link href={`/reports/${r.id}`} className={styles.card}>
              <p className={styles.cardTitle}>
                {r.title ?? `Closure report #${r.closure_event_seq}`}
              </p>
              <div className={styles.row}>
                <span>{r.asset_name ?? "unknown asset"}</span>
                {r.outcome && <span>· {r.outcome.replaceAll("_", " ")}</span>}
                {r.risk_level && (
                  <span className="badge" data-risk={r.risk_level}>
                    {r.risk_level}
                  </span>
                )}
                <span>· {new Date(r.generated_at).toLocaleString()}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
