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

function SortIcon({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg
      className={styles.sortIcon}
      data-dir={dir}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 13.5 V2.5 M4.5 10 L8 13.5 L11.5 10" />
    </svg>
  );
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
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = useCallback(
    (showSpinner: boolean) => {
      let cancelled = false;
      if (showSpinner) setLoading(true);
      // Explicit limit: the endpoint defaults to 200, which silently truncated
      // the register (and every headline stat computed from it) once the corpus
      // grew past that. 1000 is the endpoint's own ceiling — see
      // reports/routes.py::get_reports.
      void fetchReports({ include_superseded: includeSuperseded, limit: 1000 })
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
    const filtered = reports.filter((r) => {
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
    const sorted = [...filtered].sort((a, b) => {
      const at = new Date(a.frozen_at ?? a.generated_at).getTime();
      const bt = new Date(b.frozen_at ?? b.generated_at).getTime();
      return sortDir === "desc" ? bt - at : at - bt;
    });
    return sorted;
  }, [reports, outcome, risks, query, sortDir]);

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
            Closing a review freezes a permanent packet: the decision, the
            evidence it rested on, and the regulations cited, sealed under a
            hash-chained audit trail.
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
        <div className={styles.hero} title="Current versions only">
          <span className={styles.heroValue}>{kpis.total}</span>
          <span className={styles.heroLabel}>Frozen packets</span>
        </div>
        <div
          className={styles.hero}
          title="Work stopped by a supervisor"
          data-tone={
            kpis.blockedPct >= 50
              ? "bad"
              : kpis.blockedPct >= 20
                ? "warn"
                : "good"
          }
        >
          <span className={styles.heroValue}>{kpis.blockedPct}%</span>
          <span className={styles.heroLabel}>Blocked share</span>
        </div>
        <div
          className={styles.hero}
          title="Packets naming an OISD / Factories Act clause"
          data-tone={kpis.citationPct >= 80 ? "good" : "warn"}
        >
          <span className={styles.heroValue}>{kpis.citationPct}%</span>
          <span className={styles.heroLabel}>Carry citations</span>
        </div>
        <div
          className={styles.hero}
          title="Tasks still outstanding"
          data-tone={kpis.openTasks > 0 ? "warn" : "good"}
        >
          <span className={styles.heroValue}>{kpis.openTasks}</span>
          <span className={styles.heroLabel}>Open follow-through</span>
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

        <div className={styles.toolbarDivider} aria-hidden="true" />

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

        <button
          type="button"
          className={styles.sortBtn}
          aria-label={
            sortDir === "desc" ? "Sorted newest first" : "Sorted oldest first"
          }
          onClick={() =>
            setSortDir((prev) => (prev === "desc" ? "asc" : "desc"))
          }
        >
          Date
          <SortIcon dir={sortDir} />
        </button>

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
