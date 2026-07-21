"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  PacketAuditEntry,
  PacketCitation,
  PacketContextEntry,
  PacketDisposition,
  PacketTask,
  Report,
} from "@/shared/schemas";
import { fetchReport, reportPdfUrl, reportXlsxUrl } from "@/lib/liveApi";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  humanize,
  shortHash,
  splitSummary,
} from "@/lib/humanize";
import styles from "./ReportDetailView.module.css";

/* Outcomes borrow the risk badge palette so the masthead reads at a glance. */
function outcomeRisk(outcome: string | null | undefined): string {
  if (outcome === "blocked") return "blocking";
  if (outcome === "approved_with_conditions") return "elevated";
  if (outcome === "approved") return "nominal";
  return "halted";
}

/** Evidence is the one place domain colour is semantically true. */
function evidenceDomain(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("sensor") || c.includes("scada")) return "sensors";
  if (c.includes("permit") || c.includes("ptw")) return "permits";
  if (c.includes("worker") || c.includes("location") || c.includes("workforce"))
    return "people";
  if (c.includes("spatial") || c.includes("zone")) return "spatial";
  return "evidence";
}

const SECTIONS = [
  { id: "summary", label: "Outcome & summary" },
  { id: "decision", label: "Decision of record" },
  { id: "evidence", label: "Evidence" },
  { id: "reasoning", label: "Why this call" },
  { id: "citations", label: "Regulatory basis" },
  { id: "recommendations", label: "Recommended actions" },
  { id: "tasks", label: "Follow-through" },
  { id: "audit", label: "Audit trail" },
] as const;

function EvidenceEntry({ entry }: { entry: PacketContextEntry }) {
  const domain = evidenceDomain(entry.category);
  const confidence =
    entry.confidence != null
      ? Math.max(0, Math.min(1, entry.confidence))
      : null;
  const hasPayload =
    entry.payload && Object.keys(entry.payload).length > 0;
  return (
    <div className={styles.evidenceCard} data-domain={domain}>
      <div className={styles.evidenceTop}>
        <span className={styles.categoryChip}>{entry.category_label}</span>
        {confidence != null && (
          <span className={styles.meter}>
            <span className={styles.meterTrack}>
              <span
                className={styles.meterFill}
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </span>
            <span className={styles.meterValue}>
              {Math.round(confidence * 100)}%
            </span>
          </span>
        )}
      </div>
      <p className={styles.summaryLine}>{entry.summary_line}</p>
      <div className={styles.evidenceMeta}>
        {entry.provider && <span>{entry.provider}</span>}
        {entry.valid_from && (
          <span data-numeric="true">
            {formatDateTime(entry.valid_from)}
            {entry.valid_until ? ` → ${formatDateTime(entry.valid_until)}` : ""}
          </span>
        )}
      </div>
      {hasPayload && (
        <details className={styles.details}>
          <summary className={styles.detailsSummary}>Technical detail</summary>
          {entry.id && (
            <p className={styles.entryId}>entry {entry.id}</p>
          )}
          <pre className={styles.payload}>
            {JSON.stringify(entry.payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function CitationCard({ citation }: { citation: PacketCitation }) {
  return (
    <div className={styles.citationCard}>
      <div className={styles.citationTop}>
        {citation.code && (
          <span className={styles.citationCode}>{citation.code}</span>
        )}
        {citation.title && (
          <span className={styles.citationTitle}>{citation.title}</span>
        )}
        {citation.cited_in_summary && (
          <span className={styles.citedMark}>Cited in summary</span>
        )}
      </div>
      {citation.clause && <p className={styles.clause}>{citation.clause}</p>}
      {citation.source_url && (
        <a
          className={styles.sourceLink}
          href={citation.source_url}
          target="_blank"
          rel="noreferrer"
        >
          View primary source ↗
        </a>
      )}
    </div>
  );
}

function Recommendation({
  rec,
  index,
}: {
  rec: PacketDisposition;
  index: number;
}) {
  return (
    <li className={styles.recItem}>
      <span className={styles.recIndex} aria-hidden="true">
        {index + 1}
      </span>
      <div className={styles.recBody}>
        <p className={styles.recText}>{rec.text}</p>
        {rec.rationale && (
          <p className={styles.recRationale}>{rec.rationale}</p>
        )}
      </div>
      {rec.disposition && (
        <span
          className="badge"
          data-risk={
            rec.disposition === "accepted"
              ? "nominal"
              : rec.disposition === "rejected"
                ? "blocking"
                : undefined
          }
        >
          {humanize(rec.disposition)}
        </span>
      )}
    </li>
  );
}

function taskRisk(status: string): string {
  if (status === "done") return "nominal";
  if (status === "cancelled") return "halted";
  if (status === "open") return "elevated";
  return "info";
}

function Panel({
  id,
  title,
  count,
  children,
  anchor,
}: {
  id: string;
  title: string;
  count?: number;
  children: React.ReactNode;
  /** Optional data-tour value so the guided tour can spotlight this panel. */
  anchor?: string;
}) {
  return (
    <section id={id} className={styles.panel} data-tour={anchor}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {count != null && <span className={styles.panelCount}>{count}</span>}
      </div>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

function LoadingDoc() {
  return (
    <div className={styles.page}>
      <div className={styles.doc}>
        <div className={styles.skeletonBlock} data-size="sm" />
        <div className={styles.skeletonBlock} />
        <div className={styles.skeletonBlock} />
      </div>
    </div>
  );
}

export function ReportDetailView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchReport(reportId)
      .then((data) => {
        if (!cancelled) {
          setReport(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.doc}>
          <p className="text-error">{error}</p>
          <Link href="/reports">← Back to reports</Link>
        </div>
      </div>
    );
  }

  if (!report) return <LoadingDoc />;

  const { content, integrity } = report;
  const { meta, header, decision, assessment, citations, evidence, tasks } =
    content;
  const legacy = meta.packet_version < 2;

  const summaryParts = assessment?.summary
    ? splitSummary(assessment.summary)
    : null;

  const hashState =
    integrity.content_hash_status === "match" && integrity.chain_intact
      ? "match"
      : integrity.content_hash_status === "mismatch" || !integrity.chain_intact
        ? "mismatch"
        : "not_recorded";

  const stampLabel =
    hashState === "match"
      ? "Integrity verified"
      : hashState === "mismatch"
        ? "Integrity check failed"
        : "Hash not recorded";
  const stampMark = hashState === "match" ? "✓" : hashState === "mismatch" ? "!" : "–";

  const recommendations = content.recommendations ?? [];
  const auditTrail = content.audit_trail ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.doc}>
        <p className={styles.breadcrumb}>
          <Link href="/reports">← Reports</Link>
          <span aria-hidden="true">·</span>
          <Link href={`/reviews/${report.review_id}`}>Open live review</Link>
        </p>

        <header className={styles.masthead}>
          <div className={styles.mastheadText}>
            <span className={styles.ref}>
              {meta.report_ref} · {report.version_label}
            </span>
            <h1 className={styles.assetName}>{header.asset.name}</h1>
            <p className={styles.headline}>{header.outcome_headline}</p>
            <div className={styles.badges}>
              {decision && (
                <span
                  className="badge"
                  data-risk={outcomeRisk(decision.outcome)}
                >
                  {decision.outcome_label || humanize(decision.outcome)}
                </span>
              )}
              {assessment?.risk_level && (
                <span className="badge" data-risk={assessment.risk_level}>
                  {assessment.risk_level}
                </span>
              )}
            </div>
          </div>
          <div className={styles.mastheadActions}>
            <a className="btn btn-primary" href={reportPdfUrl(report.id)}>
              Download PDF
            </a>
            <a className="btn" href={reportXlsxUrl(report.id)}>
              Download Excel
            </a>
          </div>
        </header>

        <div className={styles.stamp} data-state={hashState}>
          <span className={styles.stampMark} aria-hidden="true">
            {stampMark}
          </span>
          <span className={styles.stampLabel}>{stampLabel}</span>
          <span className={styles.stampNote}>
            Frozen {formatDateTime(report.frozen_at ?? report.generated_at)}
          </span>
          <span className={styles.stampValue}>
            hash {shortHash(report.content_hash)}
          </span>
        </div>

        {!report.is_current && (
          <div className={styles.banner} data-tone="superseded">
            <span>This packet has been superseded by a newer closure.</span>
            {report.superseded_by_report_id && (
              <Link href={`/reports/${report.superseded_by_report_id}`}>
                View current version →
              </Link>
            )}
          </div>
        )}
        {report.supersedes_report_id && (
          <div className={styles.banner}>
            <span>This packet supersedes an earlier closure.</span>
            <Link href={`/reports/${report.supersedes_report_id}`}>
              View previous version →
            </Link>
          </div>
        )}
        {legacy && (
          <div className={styles.banner}>
            This report predates packet v2; some sections were not frozen and
            may read from live state.
          </div>
        )}

        <div className={styles.layout}>
          <aside className={styles.rail}>
            <nav aria-label="Sections">
              <p className={styles.railHeading}>Sections</p>
              <ul className={styles.jumpList}>
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a className={styles.jumpLink} href={`#${s.id}`}>
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div>
              <p className={styles.railHeading}>At a glance</p>
              <dl className={styles.metaList}>
                <div>
                  <dt className={styles.metaLabel}>Zone</dt>
                  <dd className={styles.metaValue}>
                    {header.asset.zone || "—"}
                  </dd>
                </div>
                <div>
                  <dt className={styles.metaLabel}>Plant</dt>
                  <dd className={styles.metaValue}>
                    {header.asset.plant_id || "—"}
                  </dd>
                </div>
                {header.owner && (
                  <div>
                    <dt className={styles.metaLabel}>Owner</dt>
                    <dd className={styles.metaValue}>{header.owner.name}</dd>
                  </div>
                )}
                <div>
                  <dt className={styles.metaLabel}>Opened</dt>
                  <dd className={styles.metaValue} data-numeric="true">
                    {formatDate(header.opened_at)}
                  </dd>
                </div>
                <div>
                  <dt className={styles.metaLabel}>Closed</dt>
                  <dd className={styles.metaValue} data-numeric="true">
                    {formatDate(header.closed_at)}
                  </dd>
                </div>
                <div>
                  <dt className={styles.metaLabel}>Duration</dt>
                  <dd className={styles.metaValue} data-numeric="true">
                    {formatDuration(header.duration_seconds)}
                  </dd>
                </div>
                {report.closed_by && (
                  <div>
                    <dt className={styles.metaLabel}>Closed by</dt>
                    <dd className={styles.metaValue}>{report.closed_by}</dd>
                  </div>
                )}
              </dl>
            </div>

            {report.versions.length > 1 && (
              <div>
                <p className={styles.railHeading}>Versions</p>
                <ul className={styles.versionTrail}>
                  {report.versions.map((v) => (
                    <li
                      key={v.id}
                      className={styles.versionItem}
                      data-current={v.is_current}
                    >
                      {v.id === report.id ? (
                        <span className={styles.versionLabel}>
                          {v.version_label}
                        </span>
                      ) : (
                        <Link
                          href={`/reports/${v.id}`}
                          className={styles.versionLabel}
                        >
                          {v.version_label}
                        </Link>
                      )}
                      <span className={styles.versionDate}>
                        {formatDate(v.generated_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          <div className={styles.body}>
            <Panel id="summary" title="Outcome & summary">
              {summaryParts ? (
                <>
                  <p className={styles.lead}>{summaryParts.lead}</p>
                  {summaryParts.points.length > 0 && (
                    <ul className={styles.points}>
                      {summaryParts.points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className={styles.muted}>
                  No assessment summary was frozen with this packet.
                </p>
              )}
              {assessment && (
                <div className={styles.fieldGrid}>
                  {assessment.provider && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Author</span>
                      <span className={styles.fieldValue}>
                        {assessment.provider}
                        {assessment.model ? ` · ${assessment.model}` : ""}
                      </span>
                    </div>
                  )}
                  {assessment.retrieval_mode && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Retrieval</span>
                      <span className={styles.fieldValue}>
                        {humanize(assessment.retrieval_mode)}
                        {assessment.retrieval_quality
                          ? ` · ${humanize(assessment.retrieval_quality)}`
                          : ""}
                      </span>
                    </div>
                  )}
                  {assessment.confidence != null && (
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Confidence</span>
                      <span className={styles.fieldValue} data-numeric="true">
                        {Math.round(assessment.confidence * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <Panel id="decision" title="Decision of record">
              {decision ? (
                <>
                  <p className={styles.lead}>
                    {decision.outcome_label || humanize(decision.outcome)}
                    {decision.decided_by
                      ? ` — ${decision.decided_by.name}`
                      : ""}
                  </p>
                  {decision.conditions && (
                    <p className={styles.callout}>{decision.conditions}</p>
                  )}
                  {decision.comments && (
                    <p className={styles.prose}>{decision.comments}</p>
                  )}
                  <div className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Submitted</span>
                      <span className={styles.fieldValue} data-numeric="true">
                        {formatDateTime(decision.submitted_at)}
                      </span>
                    </div>
                    {decision.time_to_decision_seconds != null && (
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>
                          Time to decision
                        </span>
                        <span className={styles.fieldValue} data-numeric="true">
                          {formatDuration(decision.time_to_decision_seconds)}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className={styles.muted}>
                  No decision was recorded on this review.
                </p>
              )}
            </Panel>

            <Panel
              id="evidence"
              title="Evidence"
              count={evidence.entries.length}
            >
              {evidence.source === "unavailable" ? (
                <p className={styles.muted}>
                  {evidence.note ??
                    "Evidence was not frozen for this packet."}
                </p>
              ) : evidence.entries.length > 0 ? (
                <div className={styles.cards}>
                  {evidence.entries.map((entry, i) => (
                    <EvidenceEntry key={entry.id ?? i} entry={entry} />
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>
                  No context entries were captured.
                </p>
              )}
            </Panel>

            <Panel id="reasoning" title="Why this call was made">
              {content.reasoning_factors.length > 0 ? (
                <ul className={styles.points}>
                  {content.reasoning_factors.map((factor, i) => {
                    const headline =
                      typeof factor.headline === "string"
                        ? factor.headline
                        : typeof factor.fact_type === "string"
                          ? humanize(factor.fact_type)
                          : "Factor";
                    const detail =
                      typeof factor.detail === "string" ? factor.detail : null;
                    return (
                      <li key={i}>
                        <strong>{headline}</strong>
                        {detail ? ` — ${detail}` : ""}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.muted}>
                  No individual reasoning factors were recorded.
                </p>
              )}
            </Panel>

            <Panel
              id="citations"
              title="Regulatory basis"
              count={citations.references.length}
            >
              {citations.source === "unavailable" ? (
                <p className={styles.muted}>
                  Citations were not frozen for this packet.
                </p>
              ) : citations.references.length > 0 ? (
                <div className={styles.cards}>
                  {citations.references.map((c, i) => (
                    <CitationCard key={c.id ?? i} citation={c} />
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>
                  No regulations were cited for this decision.
                </p>
              )}
            </Panel>

            <Panel
              id="recommendations"
              title="Recommended actions"
              count={recommendations.length}
            >
              {recommendations.length > 0 ? (
                <ol className={styles.recList}>
                  {recommendations.map((rec, i) => (
                    <Recommendation
                      key={rec.recommendation_id ?? i}
                      rec={rec}
                      index={i}
                    />
                  ))}
                </ol>
              ) : (
                <p className={styles.muted}>No recommendations were issued.</p>
              )}
            </Panel>

            <Panel id="tasks" title="Follow-through tasks" count={tasks.total}>
              {tasks.source === "unavailable" ? (
                <p className={styles.muted}>
                  Task state was not frozen for this packet.
                </p>
              ) : tasks.items.length > 0 ? (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Task</th>
                        <th scope="col">Assigned</th>
                        <th scope="col">Status</th>
                        <th scope="col">Done</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.items.map((t: PacketTask) => (
                        <tr key={t.id}>
                          <td>{t.title}</td>
                          <td>{t.assigned_worker_name ?? "—"}</td>
                          <td>
                            <span className="badge" data-risk={taskRisk(t.status)}>
                              {humanize(t.status)}
                            </span>
                          </td>
                          <td data-numeric="true">
                            {t.done_at ? formatDate(t.done_at) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.muted}>
                  This decision spawned no follow-through tasks.
                </p>
              )}
            </Panel>

            <Panel
              id="audit"
              title="Audit trail"
              count={auditTrail.length}
              anchor="audit-chain"
            >
              <span
                className={styles.chainChip}
                data-intact={integrity.chain_intact}
              >
                {integrity.chain_intact
                  ? `Chain intact · ${integrity.chain_entries_checked} entries`
                  : "Chain broken"}
              </span>
              {auditTrail.length > 0 ? (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Seq</th>
                        <th scope="col">Event</th>
                        <th scope="col">Actor</th>
                        <th scope="col">Recorded</th>
                        <th scope="col">Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditTrail.map((e: PacketAuditEntry, i) => (
                        <tr key={e.seq ?? i}>
                          <td data-numeric="true">{e.seq ?? "—"}</td>
                          <td>{e.event_label}</td>
                          <td>{e.actor ?? "system"}</td>
                          <td data-numeric="true">
                            {formatDateTime(e.recorded_at)}
                          </td>
                          <td data-numeric="true">{shortHash(e.entry_hash, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.muted}>No audit entries were frozen.</p>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
