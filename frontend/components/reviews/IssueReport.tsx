"use client";

import type { AssessmentHistoryItem } from "@/lib/liveApi";
import type { LiveAssetView } from "@/lib/liveStore";
import { openWorkDisplayRisk } from "@/lib/sensorThresholds";
import { labelSupervisorConcern } from "@/lib/supervisorConcern";
import type { ReasoningFactor, RetrievedReference } from "@/shared/schemas";
import styles from "./IssueReport.module.css";

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function factorsOf(assessment: AssessmentHistoryItem | null): ReasoningFactor[] {
  if (!assessment) return [];
  return (
    assessment.reasoning_factors ??
    assessment.metadata?.reasoning_factors ??
    []
  );
}

function refLabel(r: RetrievedReference): string {
  if (r.code && r.title) return `${r.code}: ${r.title}`;
  if (r.title) return r.title;
  return r.source.replaceAll("_", " ");
}

/** Drop internal architecture jargon from operator-facing copy. */
function humanizeDetail(text: string, fallbackTitle: string): string {
  const derived = text.match(
    /^Derived fact ['"]?([a-z0-9_]+)['"]? is active on (.+)\.?$/i,
  );
  if (derived) {
    const asset = derived[2]?.replace(/\.$/, "") ?? "this asset";
    return `${fallbackTitle} is active on ${asset}.`;
  }
  return text;
}

function scrubAgentTitle(point: string): string {
  return point.replace(
    /:\s*(?:SCADA\s*\/\s*Sensor|Permit\s*\/\s*PTW|Maintenance|Workforce\s*\/\s*Zone|Spatial|Incident|Handover|Forecast)\s*Agent:\s*/i,
    ": ",
  );
}

function isClearancePoint(point: string): boolean {
  const lower = point.toLowerCase();
  return (
    lower.includes("no active hazards") ||
    lower.includes("no hot-work") ||
    lower.includes("no co-occurrence") ||
    lower.includes("no imminent threshold") ||
    lower.includes("nothing to report") ||
    /:\s*no\b/.test(lower)
  );
}

function splitSummary(summary: string): { lead: string; points: string[] } {
  const lines = summary
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length >= 2) {
    return {
      lead: lines[0]!,
      points: lines
        .slice(1)
        .map((l) => l.replace(/^[•\-\*]\s*/, ""))
        .map(scrubAgentTitle)
        .filter((p) => !isClearancePoint(p)),
    };
  }

  // Legacy jammed summaries: "Lead. Label: note Label: note"
  const single = summary.trim();
  const labelRe =
    /\b(?:Sensors|Permits|Maintenance|Crew|Nearby area|Past incidents|Shift notes|Forecast|SCADA|Permit|Spatial|Workforce|Incident|Handover):/g;
  const firstLabel = labelRe.exec(single);
  if (firstLabel && firstLabel.index != null && firstLabel.index > 0) {
    const lead = single.slice(0, firstLabel.index).trim();
    const rest = single.slice(firstLabel.index).trim();
    labelRe.lastIndex = 0;
    const parts: string[] = [];
    let match: RegExpExecArray | null;
    const starts: number[] = [];
    while ((match = labelRe.exec(rest)) != null) {
      starts.push(match.index);
    }
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i]!;
      const end = starts[i + 1] ?? rest.length;
      parts.push(rest.slice(start, end).trim());
    }
    const points = parts
      .filter(Boolean)
      .map((p) =>
        p
          .replace(/^SCADA:\s*/i, "Sensors: ")
          .replace(/^Spatial:\s*/i, "Nearby area: ")
          .replace(/^Workforce:\s*/i, "Crew: ")
          .replace(/^Incident:\s*/i, "Past incidents: ")
          .replace(/^Handover:\s*/i, "Shift notes: ")
          .replace(/^Permit:\s*/i, "Permits: "),
      )
      .map(scrubAgentTitle)
      .filter((p) => !isClearancePoint(p));
    if (lead && points.length > 0) return { lead, points };
    if (lead) return { lead, points: [] };
  }

  return { lead: single, points: [] };
}

interface WhyItem {
  id: string;
  title: string;
  body: string | null;
}

function whyItems(
  view: LiveAssetView,
  assessment: AssessmentHistoryItem | null,
): WhyItem[] {
  const factors = factorsOf(assessment).filter(
    (f) => f.fact_type !== "predicted_trend_risk",
  );
  if (factors.length > 0) {
    return factors.map((f) => {
      const title = f.headline || humanize(f.fact_type);
      return {
        id: f.fact_type,
        title,
        body: f.detail?.trim()
          ? humanizeDetail(f.detail.trim(), title)
          : null,
      };
    });
  }

  const derived = view.detail?.derived_facts ?? [];
  return derived.map((f) => {
    const title = humanize(String(f.fact_type));
    let body: string | null = null;
    if (typeof f.value === "string") {
      body = humanizeDetail(f.value, title);
    } else if (f.value === true) {
      body = `${title} was detected on ${view.asset.name}.`;
    } else if (f.value != null) {
      body = `${title} — ${String(f.value)}`;
    }
    return { id: String(f.fact_type), title, body };
  });
}

interface IssueReportProps {
  view: LiveAssetView;
  assessment: AssessmentHistoryItem | null;
  inProgress?: boolean;
  /** Supervisor drawer: summary (and their report) only — no why/citations. */
  summaryOnly?: boolean;
}

export function IssueReport({
  view,
  assessment,
  inProgress = false,
  summaryOnly = false,
}: IssueReportProps) {
  const review = view.review;
  const displayRisk = openWorkDisplayRisk(
    assessment?.risk_level ?? view.risk_level,
    view.sensor_critical,
  );
  const rawSummary = assessment?.summary?.trim() || null;
  const summaryParts = rawSummary ? splitSummary(rawSummary) : null;
  const why = summaryOnly ? [] : whyItems(view, assessment);
  const refs = summaryOnly
    ? []
    : (assessment?.retrieved_references ?? []);
  const trigger = review?.triggered_by
    ? humanize(review.triggered_by)
    : "Review";
  const assetName = view.asset.name;
  const createdAt = review?.created_at
    ? new Date(review.created_at).toLocaleString()
    : null;
  const ownerName = view.detail?.area_owner?.name ?? null;
  const supervisorReport = view.detail?.supervisor_report ?? null;

  const metaLine = (
    <>
      <p className={styles.sub}>Triggered by {trigger}</p>
      {(createdAt || ownerName) && (
        <p className={styles.meta}>
          {createdAt}
          {createdAt && ownerName ? " · " : ""}
          {ownerName}
        </p>
      )}
    </>
  );

  const hasNarrative =
    Boolean(supervisorReport) ||
    Boolean(rawSummary) ||
    why.length > 0 ||
    refs.length > 0;

  const supervisorSection = supervisorReport ? (
    <section
      className={styles.supervisorSection}
      aria-labelledby="issue-supervisor-heading"
    >
      <h3 id="issue-supervisor-heading" className={styles.sectionTitle}>
        Supervisor report
      </h3>
      <p className={styles.supervisorMeta}>
        <span className="badge" data-risk={openWorkDisplayRisk(
          supervisorReport.concern_type === "safety_hazard"
            ? "blocking"
            : "elevated",
          view.sensor_critical,
        )}>
          {labelSupervisorConcern(supervisorReport.concern_type)}
        </span>
        · Reported by {supervisorReport.reported_by_name}
      </p>
      <blockquote className={styles.supervisorQuote}>
        {supervisorReport.description}
      </blockquote>
    </section>
  ) : null;

  if (inProgress && !hasNarrative) {
    return (
      <article
        className={styles.root}
        data-risk={displayRisk}
        aria-label="Issue report"
        aria-busy="true"
      >
        <header className={styles.header}>
          <p className={styles.eyebrow}>Issue report</p>
          <h2 className={styles.title}>
            <span className={styles.risk} data-risk={displayRisk}>
              {displayRisk}
            </span>
            <span className={styles.titleSep}>·</span>
            {assetName}
          </h2>
          {metaLine}
        </header>
        {supervisorSection}
        <p className={styles.placeholder}>
          {summaryOnly
            ? "Investigation in progress — the summary will appear here when the assessment settles."
            : "Investigation in progress — the full write-up will appear here when the assessment settles."}
        </p>
      </article>
    );
  }

  if (!hasNarrative && !assessment) {
    return (
      <article
        className={styles.root}
        data-risk={displayRisk}
        aria-label="Issue report"
      >
        <header className={styles.header}>
          <p className={styles.eyebrow}>Issue report</p>
          <h2 className={styles.title}>
            <span className={styles.risk} data-risk={displayRisk}>
              {displayRisk}
            </span>
            <span className={styles.titleSep}>·</span>
            {assetName}
          </h2>
          {metaLine}
        </header>
        {supervisorSection}
        <p className={styles.placeholder}>
          {summaryOnly
            ? "No summary yet — waiting for the assessment to settle."
            : "No assessment write-up yet — waiting for the pipeline or a manual assessment."}
        </p>
      </article>
    );
  }

  return (
    <article
      className={styles.root}
      data-risk={displayRisk}
      aria-label="Issue report"
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>Issue report</p>
        <h2 className={styles.title}>
          <span className={styles.risk} data-risk={displayRisk}>
            {displayRisk}
          </span>
          <span className={styles.titleSep}>·</span>
          {assetName}
        </h2>
        {metaLine}
      </header>

      {supervisorSection}

      {summaryParts ? (
        <section className={styles.section} aria-labelledby="issue-summary-heading">
          <h3 id="issue-summary-heading" className={styles.sectionTitle}>
            Summary
          </h3>
          <p className={styles.lead}>{summaryParts.lead}</p>
          {summaryParts.points.length > 0 ? (
            <ul className={styles.pointList}>
              {summaryParts.points.map((point) => (
                <li key={point} className={styles.pointItem}>
                  {point}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {why.length > 0 ? (
        <section className={styles.section} aria-labelledby="issue-why-heading">
          <h3 id="issue-why-heading" className={styles.sectionTitle}>
            Why this matters
          </h3>
          <ul className={styles.factorList}>
            {why.map((item) => (
              <li key={item.id} className={styles.factorItem}>
                <strong className={styles.factorTitle}>{item.title}</strong>
                {item.body ? (
                  <p className={styles.factorBody}>{item.body}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {refs.length > 0 ? (
        <section
          className={styles.section}
          aria-labelledby="issue-evidence-heading"
        >
          <h3 id="issue-evidence-heading" className={styles.sectionTitle}>
            Cited evidence
          </h3>
          <ul className={styles.refList}>
            {refs.map((r) => (
              <li key={`${r.source}-${r.id}`} className={styles.refItem}>
                <span className={styles.refSource}>
                  {r.source.replaceAll("_", " ")}
                </span>
                <div className={styles.refBody}>
                  <p className={styles.refTitle}>{refLabel(r)}</p>
                  {r.snippet ? (
                    <p className={styles.refSnippet}>{r.snippet}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
