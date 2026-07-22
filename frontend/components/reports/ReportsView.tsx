"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  fetchReports,
  reportPdfUrl,
  reportXlsxUrl,
  reportsDatasetXlsxUrl,
  type ReportSummary,
} from "@/lib/liveApi";
import { useLiveStore } from "@/lib/liveStore";
import { formatDateTime, humanize } from "@/lib/humanize";
import styles from "./ReportsView.module.css";

const OUTCOMES = [
  { value: "", label: "All outcomes" },
  { value: "blocked", label: "Blocked" },
  { value: "approved_with_conditions", label: "Conditional" },
  { value: "approved", label: "Approved" },
] as const;

const RISKS = ["critical", "blocking", "elevated", "nominal"] as const;

/** Decision outcomes borrow the risk badge palette so the register reads at a glance. */
function outcomeRisk(outcome: string | null): string {
  if (outcome === "blocked") return "blocking";
  if (outcome === "approved_with_conditions") return "elevated";
  if (outcome === "approved") return "nominal";
  return "halted";
}

function SearchIcon() {
  return (
    <svg
      className={styles.searchIcon}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
    </svg>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6].map((c) => (
            <td key={c}>
              <span className={styles.skeletonCell} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function ReportsView() {
  const router = useRouter();
  const reportEventSeq = useLiveStore((s) => s.reportEventSeq);

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [outcome, setOutcome] = useState<string>("");
  const [risks, setRisks] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [includeSuperseded, setIncludeSuperseded] = useState(false);

  const load = useCallback(
    (showSpinner: boolean) => {
      let cancelled = false;
      if (showSpinner) setLoading(true);
      void fetchReports({ include_superseded: includeSuperseded })
        .then((data) => {
          if (cancelled) return;
          setReports(data);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    },
    [includeSuperseded],
  );

  useEffect(() => load(true), [load]);
  // A freeze happens elsewhere in the app; coalesce bursts so the register
  // stays fresh without stacking overlapping fetches.
  useEffect(() => {
    if (reportEventSeq === 0) return;
    const timer = window.setTimeout(() => load(false), 350);
    return () => window.clearTimeout(timer);
  }, [reportEventSeq, load]);

  const toggleRisk = (risk: string) =>
    setRisks((prev) =>
      prev.includes(risk) ? prev.filter((r) => r !== risk) : [...prev, risk],
    );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (outcome && r.outcome !== outcome) return false;
      if (risks.length > 0 && !risks.includes(r.risk_level ?? "")) return false;
      if (!q) return true;
      return (
        (r.asset_name ?? "").toLowerCase().includes(q) ||
        (r.asset_zone ?? "").toLowerCase().includes(q) ||
        r.report_ref.toLowerCase().includes(q) ||
        (r.decided_by_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [reports, outcome, risks, query]);

  const kpis = useMemo(() => {
    const current = reports.filter((r) => r.is_current);
    const total = current.length;
    const blocked = current.filter((r) => r.outcome === "blocked").length;
    const withCitations = current.filter((r) => r.citation_count > 0).length;
    const openTasks = current.reduce((sum, r) => sum + r.open_tasks, 0);
    return {
      total,
      blockedPct: total ? Math.round((blocked / total) * 100) : 0,
      citationPct: total ? Math.round((withCitations / total) * 100) : 0,
      openTasks,
    };
  }, [reports]);

  const filtersActive =
    Boolean(outcome) || risks.length > 0 || query.trim().length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Closure reports</h1>
          <p className={styles.subtitle}>
            Closing a decided review freezes an immutable audit packet — the
            decision of record, the evidence it rested on, the regulations
            cited, and the hash-chained trail behind it.
          </p>
        </div>
        <div className={styles.headerActions}>
          <a
            className={styles.ctrl}
            href={reportsDatasetXlsxUrl(includeSuperseded)}
          >
            Export all to Excel
          </a>
        </div>
      </header>

      <div className={styles.heroRow}>
        <div className={styles.hero}>
          <span className={styles.heroValue}>{kpis.total}</span>
          <span className={styles.heroLabel}>Frozen packets</span>
          <span className={styles.heroHint}>Current versions only</span>
        </div>
        <div
          className={styles.hero}
          data-tone={kpis.blockedPct >= 50 ? "bad" : "warn"}
        >
          <span className={styles.heroValue}>{kpis.blockedPct}%</span>
          <span className={styles.heroLabel}>Blocked share</span>
          <span className={styles.heroHint}>Work stopped by a supervisor</span>
        </div>
        <div
          className={styles.hero}
          data-tone={kpis.citationPct >= 80 ? "good" : "warn"}
        >
          <span className={styles.heroValue}>{kpis.citationPct}%</span>
          <span className={styles.heroLabel}>Carry citations</span>
          <span className={styles.heroHint}>
            Packets naming an OISD / Factories Act clause
          </span>
        </div>
        <div
          className={styles.hero}
          data-tone={kpis.openTasks > 0 ? "warn" : "good"}
        >
          <span className={styles.heroValue}>{kpis.openTasks}</span>
          <span className={styles.heroLabel}>Open follow-through</span>
          <span className={styles.heroHint}>Tasks still outstanding</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="Outcome">
          {OUTCOMES.map((o) => (
            <button
              key={o.value || "all"}
              type="button"
              className={styles.segment}
              data-active={outcome === o.value}
              aria-pressed={outcome === o.value}
              onClick={() => setOutcome(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className={styles.riskFilters} role="group" aria-label="Risk level">
          {RISKS.map((risk) => (
            <button
              key={risk}
              type="button"
              className={styles.riskChip}
              data-risk={risk}
              data-active={risks.includes(risk)}
              aria-pressed={risks.includes(risk)}
              onClick={() => toggleRisk(risk)}
            >
              {risk}
            </button>
          ))}
        </div>

        <div className={styles.searchWrap}>
          <SearchIcon />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search asset, zone, ref or supervisor"
            aria-label="Search reports"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </div>

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={includeSuperseded}
            onChange={(e) => setIncludeSuperseded(e.target.checked)}
          />
          Show superseded
        </label>

        <p className={styles.filterMeta} role="status">
          <span className={styles.filterCount}>
            {visible.length} of {reports.length}
          </span>
          {filtersActive && (
            <button
              type="button"
              className={styles.clearFilters}
              onClick={() => {
                setOutcome("");
                setRisks([]);
                setQuery("");
              }}
            >
              Clear filters
            </button>
          )}
        </p>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Register</h2>
        </div>

        {!loading && !error && visible.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>
              {reports.length === 0
                ? "No packets frozen yet"
                : "No packets match these filters"}
            </p>
            <p className={styles.emptyCopy}>
              {reports.length === 0
                ? "A packet is created the moment a decided review is closed. Record a decision on a review, then close it, and it will appear here."
                : "Loosen the outcome or risk filters, or clear the search."}
            </p>
          </div>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Ref</th>
                  <th scope="col">Asset</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Decided by</th>
                  <th scope="col">Frozen</th>
                  <th scope="col" className={styles.exportCell}>
                    Export
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkeletonRows />}
                {!loading &&
                  visible.map((r) => (
                    <tr
                      key={r.id}
                      data-superseded={!r.is_current}
                      onClick={() => router.push(`/reports/${r.id}`)}
                    >
                      <td className={styles.refCell}>
                        <Link
                          href={`/reports/${r.id}`}
                          className={styles.refLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.report_ref}
                        </Link>
                        {!r.is_current && (
                          <>
                            {" "}
                            <span className="badge" data-risk="halted">
                              {r.version_label} · superseded
                            </span>
                          </>
                        )}
                      </td>
                      <td>
                        <span className={styles.assetName}>
                          {r.asset_name ?? "Unknown asset"}
                        </span>
                        {r.asset_zone && (
                          <span className={styles.assetZone}>{r.asset_zone}</span>
                        )}
                      </td>
                      <td>
                        <span
                          className="badge"
                          data-risk={outcomeRisk(r.outcome)}
                        >
                          {r.outcome_label ??
                            (r.outcome ? humanize(r.outcome) : "no decision")}
                        </span>
                      </td>
                      <td>
                        {r.risk_level ? (
                          <span className="badge" data-risk={r.risk_level}>
                            {r.risk_level}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={styles.person}>
                        {r.decided_by_name ?? r.closed_by ?? "—"}
                      </td>
                      <td className={styles.stamp}>
                        {formatDateTime(r.frozen_at ?? r.generated_at)}
                      </td>
                      <td className={styles.exportCell}>
                        <span className={styles.exportGroup}>
                          <a
                            className={styles.iconBtn}
                            href={reportPdfUrl(r.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Download ${r.report_ref} as PDF`}
                          >
                            PDF
                          </a>
                          <a
                            className={styles.iconBtn}
                            href={reportXlsxUrl(r.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Download ${r.report_ref} as Excel`}
                          >
                            XLSX
                          </a>
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
