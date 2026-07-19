"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Report } from "@/shared/schemas";
import { fetchReport } from "@/lib/liveApi";
import styles from "./ReportsView.module.css";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
      <div className={styles.view}>
        <p className={styles.error}>{error}</p>
        <Link href="/reports">← Back to reports</Link>
      </div>
    );
  }

  if (!report) {
    return (
      <div className={styles.view}>
        <p className={styles.empty}>Loading report…</p>
      </div>
    );
  }

  const content = report.content ?? {};
  const asset = asRecord(content.asset);
  const assessment = asRecord(content.assessment_snapshot);
  const decision = asRecord(content.decision);
  const evidence = asRecord(content.evidence);
  const recommendations = Array.isArray(assessment?.recommendations)
    ? (assessment.recommendations as Record<string, unknown>[])
    : [];
  const meta = asRecord(assessment?.metadata);

  return (
    <div className={styles.view}>
      <p className={styles.meta}>
        <Link href="/reports">← Reports</Link>
        {" · "}
        <Link href={`/reviews/${report.review_id}`}>Open review</Link>
      </p>
      <h1 className={styles.title}>
        {(content.title as string) ??
          `Closure report #${report.closure_event_seq}`}
      </h1>
      <p className={styles.meta}>
        Generated {new Date(report.generated_at).toLocaleString()} · seq{" "}
        {report.closure_event_seq}
      </p>

      <section className={styles.section} data-domain="people">
        <h3>
          <span
            className={styles.domainDot}
            style={{ background: "var(--domain-people)" }}
          />
          Asset
        </h3>
        <p>
          <strong>{String(asset?.name ?? "—")}</strong> · zone{" "}
          {String(asset?.zone ?? "—")}
        </p>
      </section>

      <section className={styles.section} data-domain="evidence">
        <h3>
          <span
            className={styles.domainDot}
            style={{ background: "var(--domain-evidence)" }}
          />
          Assessment snapshot
        </h3>
        {assessment ? (
          <>
            <p>
              <span
                className="badge"
                data-risk={String(assessment.risk_level ?? "")}
              >
                {String(assessment.risk_level ?? "—")}
              </span>
            </p>
            <p className={styles.bodyText}>
              {String(assessment.summary ?? "")}
            </p>
            {meta && (
              <p className={styles.meta}>
                {String(meta.provider ?? "—")} · retrieval{" "}
                {String(meta.retrieval_mode ?? "—")} (
                {String(meta.retrieval_quality ?? "—")})
              </p>
            )}
            {recommendations.length > 0 && (
              <ul className={styles.recList}>
                {recommendations.map((rec) => (
                  <li key={String(rec.id)}>
                    {String(rec.text)}
                    {rec.disposition ? ` · ${String(rec.disposition)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className={styles.empty}>No assessment snapshot</p>
        )}
      </section>

      <section className={styles.section} data-domain="permits">
        <h3>
          <span
            className={styles.domainDot}
            style={{ background: "var(--domain-permits)" }}
          />
          Decision
        </h3>
        {decision ? (
          <>
            <p>
              <strong>
                {String(decision.outcome).replaceAll("_", " ")}
              </strong>
            </p>
            {decision.conditions ? (
              <p>Conditions: {String(decision.conditions)}</p>
            ) : null}
            <p className={styles.meta}>
              Submitted {String(decision.submitted_at ?? "—")}
            </p>
          </>
        ) : (
          <p className={styles.empty}>No decision snapshot</p>
        )}
      </section>

      <section className={styles.section} data-domain="sensors">
        <h3>
          <span
            className={styles.domainDot}
            style={{ background: "var(--domain-sensors)" }}
          />
          Evidence (frozen)
        </h3>
        {evidence ? (
          <>
            <p className={styles.meta}>Evidence id · {String(evidence.id)}</p>
            <p className={styles.meta}>
              Assessment · {String(evidence.frozen_assessment_id)}
            </p>
            <p className={styles.meta}>
              Context ids ·{" "}
              {Array.isArray(evidence.frozen_context_ids)
                ? evidence.frozen_context_ids.join(", ") || "none"
                : "—"}
            </p>
            <p className={styles.meta}>
              Captured {String(evidence.captured_at ?? "—")}
            </p>
          </>
        ) : (
          <p className={styles.empty}>No evidence snapshot</p>
        )}
      </section>
    </div>
  );
}
