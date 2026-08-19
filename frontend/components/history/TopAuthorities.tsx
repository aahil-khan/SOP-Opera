"use client";

/**
 * Most-cited regulations and SOPs.
 *
 * A real table, not a chart: the labels are clause codes people read rather
 * than compare by length. The inline bar is a magnitude cue on top of the
 * number, not a replacement for it.
 *
 * Citations and reviews were separate columns, but they only diverge when one
 * assessment cites the same clause twice via two facts (see
 * backend/app/history/repository.py:77-105 — `count(*)` vs
 * `count(DISTINCT a.review_id)`). Across the current corpus that never happens,
 * so every row printed the same number twice and the table read as a rendering
 * fault. They are one column now: the citation count, with the distinct-review
 * count appended only when it is genuinely lower. When nothing is appended the
 * single number is both figures at once, which the caption states.
 */

import type { HistoryCitedAuthority } from "@/lib/liveApi";
import styles from "./TopAuthorities.module.css";

export function TopAuthorities({ data }: { data: HistoryCitedAuthority[] }) {
  if (data.length === 0) {
    return <p className={styles.empty}>Nothing cited in this window.</p>;
  }
  const max = Math.max(...data.map((d) => d.citations), 1);
  const anyRepeated = data.some((d) => d.reviews < d.citations);

  return (
    <figure className={styles.figure}>
      {/* Clause codes are long and must not widen the page — the table scrolls
          inside its own container instead. Measured: without this the 390px
          viewport had a 554px body scrollWidth. */}
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Authority</th>
              <th scope="col">Kind</th>
              <th
                scope="col"
                className={styles.num}
                title="Times this clause was retrieved into an assessment. A second figure appears when one assessment cited it more than once, in which case that figure is the number of distinct reviews."
              >
                Citations
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={`${d.source}:${d.label}`}>
                <th scope="row" className={styles.label}>
                  {d.label}
                </th>
                <td>
                  <span className={styles.kind}>
                    {d.source === "sops" ? "SOP" : "Regulation"}
                  </span>
                </td>
                <td className={styles.num}>
                  <span className={styles.cell}>
                    <span className={styles.track} aria-hidden="true">
                      <span
                        className={styles.bar}
                        style={{ width: `${(d.citations / max) * 100}%` }}
                      />
                    </span>
                    {d.citations}
                    {d.reviews < d.citations ? (
                      <span className={styles.reach}>
                        {" "}
                        · {d.reviews} review{d.reviews === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className={styles.caption}>
        {anyRepeated
          ? "citations · distinct reviews, where an assessment cited a clause twice"
          : "one citation per review · no assessment cited the same clause twice"}
      </figcaption>
    </figure>
  );
}
