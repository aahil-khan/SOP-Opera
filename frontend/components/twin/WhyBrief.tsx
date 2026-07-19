"use client";

import { useState } from "react";
import type { AssessmentHistoryItem } from "@/lib/liveApi";
import type { LiveAssetView } from "@/lib/liveStore";
import type { ReasoningFactor } from "@/shared/schemas";
import styles from "./WhyBrief.module.css";

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

interface WhyItem {
  id: string;
  title: string;
  body: string | null;
}

function itemsFrom(
  view: LiveAssetView,
  assessment: AssessmentHistoryItem | null,
): WhyItem[] {
  const factors = factorsOf(assessment);
  if (factors.length > 0) {
    return factors.map((f) => ({
      id: f.fact_type,
      title: f.headline || humanize(f.fact_type),
      body: f.detail?.trim() || null,
    }));
  }

  const derived = view.detail?.derived_facts ?? [];
  return derived.map((f) => ({
    id: String(f.fact_type),
    title: humanize(String(f.fact_type)),
    body:
      typeof f.value === "string"
        ? f.value
        : f.value != null
          ? JSON.stringify(f.value)
          : null,
  }));
}

interface WhyBriefProps {
  view: LiveAssetView;
  assessment: AssessmentHistoryItem | null;
}

export function WhyBrief({ view, assessment }: WhyBriefProps) {
  const items = itemsFrom(view, assessment);
  const risk = assessment?.risk_level ?? view.risk_level;
  const [open, setOpen] = useState(false);

  if (items.length === 0) {
    return (
      <p className={styles.empty}>
        No structured reasoning yet for this assessment.
      </p>
    );
  }

  return (
    <div className={styles.root}>
      <p className={styles.headline}>
        <span className={styles.riskWord} data-risk={risk}>
          {risk}
        </span>
        <span className={styles.headlineSep}>:</span>{" "}
        {items.map((item, i) => (
          <span key={item.id}>
            {item.title.toLowerCase()}
            {i < items.length - 1 ? ", " : ""}
          </span>
        ))}
      </p>

      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide reasoning" : "Show reasoning"}
        <span className={styles.toggleIcon} data-open={open ? "true" : undefined}>
          ⌄
        </span>
      </button>

      {open && (
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
      )}
    </div>
  );
}
