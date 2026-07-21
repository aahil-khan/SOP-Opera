"use client";

import type { AssessmentHistoryItem } from "@/lib/liveApi";
import type { LiveAssetView } from "@/lib/liveStore";
import type { ReasoningFactor } from "@/shared/schemas";
import styles from "./WhyBrief.module.css";

function humanize(value: string): string {
  return value.replaceAll("_", " ");
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

function factorsOf(assessment: AssessmentHistoryItem | null): ReasoningFactor[] {
  if (!assessment) return [];
  return (
    assessment.reasoning_factors ??
    assessment.metadata?.reasoning_factors ??
    []
  );
}

interface WhyItem {
  id: string;
  title: string;
  body: string | null;
}

function itemsFrom(
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
    return {
      id: String(f.fact_type),
      title,
      body,
    };
  });
}

/** First paragraph / line of the assessment write-up for the summary panel. */
function summaryLead(assessment: AssessmentHistoryItem | null): string | null {
  const raw = assessment?.summary?.trim();
  if (!raw) return null;
  const firstLine = raw.split(/\n+/).map((l) => l.trim()).find(Boolean);
  return firstLine || null;
}

interface WhyBriefProps {
  view: LiveAssetView;
  assessment: AssessmentHistoryItem | null;
}

function residualNotice(view: LiveAssetView): {
  tone: "blocking" | "critical" | "nominal";
  title: string;
  body: string;
} | null {
  const review = view.review;
  if (!review || review.state !== "closed") return null;

  const outcome = view.detail?.decision?.outcome;
  const sensorCritical = view.sensor_critical;

  if (outcome === "blocked") {
    return {
      tone: "blocking",
      title: "Incident closed · work halted",
      body: sensorCritical
        ? "The halt decision is on record, but live readings still exceed the incident threshold. Keep the asset offline until sensors normalize."
        : "Work was halted and the review is closed. The map keeps a resolved incident marker for traceability.",
    };
  }

  if (sensorCritical) {
    return {
      tone: "critical",
      title: "Review closed — sensors still critical",
      body: "Paperwork is complete, but live readings remain above the incident line. Do not treat this asset as all clear until telemetry normalizes.",
    };
  }

  if (outcome === "approved_with_conditions") {
    return {
      tone: "blocking",
      title: "Review closed with conditions",
      body: "Proceed only after the stated conditions are verified in the field.",
    };
  }

  if (outcome === "approved") {
    return {
      tone: "nominal",
      title: "Review closed · approved",
      body: "The incident was reviewed and cleared. Details below record what triggered the review.",
    };
  }

  return null;
}

export function WhyBrief({ view, assessment }: WhyBriefProps) {
  const items = itemsFrom(view, assessment);
  const notice = residualNotice(view);
  const lead = summaryLead(assessment);

  if (items.length === 0 && !notice && !lead) {
    return (
      <p className={styles.empty}>
        No structured reasoning yet for this assessment.
      </p>
    );
  }

  return (
    <div className={styles.root}>
      {notice ? (
        <div className={styles.notice} data-tone={notice.tone}>
          <p className={styles.noticeTitle}>{notice.title}</p>
          <p className={styles.noticeBody}>{notice.body}</p>
        </div>
      ) : null}

      {lead ? <p className={styles.summary}>{lead}</p> : null}

      {items.length > 0 ? (
        <ul className={styles.detailList}>
          {items.map((item) => (
            <li key={item.id} className={styles.detailItem}>
              <strong className={styles.detailTitle}>{item.title}</strong>
              {item.body ? (
                <span className={styles.detailBody}> — {item.body}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
