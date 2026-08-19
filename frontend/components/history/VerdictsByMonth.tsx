"use client";

/**
 * Verdicts per calendar month, stacked.
 *
 * Stacked because the three verdicts are parts of one month's total — a grouped
 * chart would invite comparing blocking against nominal, which is not the
 * question. The colours are the reserved status palette (`--status-nominal` /
 * `-elevated` / `-blocking`), which is what these values literally are; they are
 * never used here as "series 1/2/3". Identity is carried by the legend and the
 * tooltip as well as colour, never by colour alone.
 */

import { useState } from "react";
import type { HistoryVerdictMonth } from "@/lib/liveApi";
import styles from "./VerdictsByMonth.module.css";

const BANDS = [
  { key: "nominal", label: "Nominal", cls: styles.nominal },
  { key: "elevated", label: "Elevated", cls: styles.elevated },
  { key: "blocking", label: "Blocking", cls: styles.blocking },
] as const;

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en", { month: "short" });
}

/** A 12-month window spans 13 buckets, so the first and last share a month name
 *  ("Aug" twice, with nothing to tell 2025 from 2026). Show the year on the
 *  first bucket and whenever it rolls over. */
function needsYear(data: HistoryVerdictMonth[], i: number): boolean {
  if (i === 0) return true;
  return data[i].month.slice(0, 4) !== data[i - 1].month.slice(0, 4);
}

export function VerdictsByMonth({ data }: { data: HistoryVerdictMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return <p className={styles.empty}>No closed reviews in this window.</p>;
  }

  const totals = data.map((d) => d.nominal + d.elevated + d.blocking);
  const max = Math.max(...totals, 1);
  const sum = {
    nominal: data.reduce((a, d) => a + d.nominal, 0),
    elevated: data.reduce((a, d) => a + d.elevated, 0),
    blocking: data.reduce((a, d) => a + d.blocking, 0),
  };
  const grand = sum.nominal + sum.elevated + sum.blocking;

  return (
    <figure className={styles.figure}>
      <div className={styles.legend}>
        {BANDS.map((b) => (
          <span key={b.key} className={styles.legendItem}>
            <span className={`${styles.swatch} ${b.cls}`} aria-hidden="true" />
            {b.label}
            <span className={styles.legendCount}>
              {Math.round((sum[b.key] / grand) * 100)}%
            </span>
          </span>
        ))}
      </div>

      <div className={styles.plot} role="img" aria-label={`Verdicts by month over ${data.length} months`}>
        {data.map((d, i) => {
          const total = totals[i];
          const isHover = hover === i;
          return (
            <div
              key={d.month}
              className={styles.column}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div className={styles.stack}>
                {BANDS.map((b) => {
                  const v = d[b.key];
                  if (v === 0) return null;
                  return (
                    <div
                      key={b.key}
                      className={`${styles.segment} ${b.cls}`}
                      style={{ height: `${(v / max) * 100}%` }}
                      title={`${d.month} · ${b.label}: ${v}`}
                    />
                  );
                })}
              </div>
              <span className={styles.tick}>
                {monthLabel(d.month)}
                {needsYear(data, i) && (
                  <span className={styles.tickYear}>{`\u2019${d.month.slice(2, 4)}`}</span>
                )}
              </span>
              {isHover && (
                <div className={styles.tooltip} role="status">
                  <strong>{d.month}</strong>
                  <span>{total} reviews</span>
                  {BANDS.map((b) => (
                    <span key={b.key}>
                      {b.label} {d[b.key]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <figcaption className={styles.caption}>
        {grand} reviews · {data.length} months
      </figcaption>
    </figure>
  );
}
