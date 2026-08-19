"use client";

/**
 * Most-cited regulations and SOPs.
 *
 * A real table, not a chart: there are two measures per row (citations and the
 * distinct reviews that produced them) and the labels are clause codes people
 * read rather than compare by length. The inline bar is a magnitude cue on top
 * of the number, not a replacement for it.
 *
 * `reviews` is shown because one assessment can cite the same clause twice via
 * two facts, so citations alone would overstate reach.
 */

import type { HistoryCitedAuthority } from "@/lib/liveApi";
import styles from "./TopAuthorities.module.css";

export function TopAuthorities({ data }: { data: HistoryCitedAuthority[] }) {
  if (data.length === 0) {
    return <p className={styles.empty}>Nothing cited in this window.</p>;
  }
  const max = Math.max(...data.map((d) => d.citations), 1);

  return (
    // Clause codes are long and must not widen the page — the table scrolls
    // inside its own container instead. Measured: without this the 390px
    // viewport had a 554px body scrollWidth.
    <div className={styles.scroller}>
      <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Authority</th>
          <th scope="col">Kind</th>
          <th scope="col" className={styles.num}>
            Citations
          </th>
          <th scope="col" className={styles.num}>
            Reviews
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
              </span>
            </td>
            <td className={styles.num}>{d.reviews}</td>
          </tr>
        ))}
        </tbody>
      </table>
    </div>
  );
}
