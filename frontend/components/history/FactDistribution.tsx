"use client";

/**
 * Which derived facts actually fire, ranked.
 *
 * One series, so one hue and no legend — the heading names it. Horizontal bars
 * because the labels are long fact names; vertical bars would rotate them.
 * Every value is printed as text beside its bar, so the chart is readable with
 * no colour perception at all.
 *
 * Nominal reviews contribute nothing here, by construction: they have no facts.
 * The caption says so rather than leaving a reader to assume this is a
 * distribution over every review.
 */

import type { HistoryFactCount } from "@/lib/liveApi";
import styles from "./FactDistribution.module.css";

/** Acronyms the plant writes in caps. Sentence-casing blindly turned
 *  `ppe_noncompliance` into "Ppe noncompliance", which reads as a typo on a page
 *  a judge is looking at. */
const ACRONYMS = new Set(["ppe", "ptw", "sop", "co", "h2s", "iso", "lel"]);

function humanize(factType: string): string {
  return factType
    .split("_")
    .map((w, i) => {
      if (ACRONYMS.has(w)) return w.toUpperCase();
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}

export function FactDistribution({ data }: { data: HistoryFactCount[] }) {
  if (data.length === 0) {
    return <p className={styles.empty}>No derived facts in this window.</p>;
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((a, d) => a + d.count, 0);

  return (
    <figure className={styles.figure}>
      <ul className={styles.rows}>
        {data.map((d) => (
          <li key={d.fact_type} className={styles.row}>
            <span className={styles.label} title={d.fact_type}>
              {humanize(d.fact_type)}
            </span>
            <span className={styles.track}>
              <span
                className={styles.bar}
                style={{ width: `${(d.count / max) * 100}%` }}
                aria-hidden="true"
              />
            </span>
            <span className={styles.value}>{d.count}</span>
          </li>
        ))}
      </ul>
      <figcaption className={styles.caption}>
        {total} facts across {data.length} types · nominal reviews have none
      </figcaption>
    </figure>
  );
}
