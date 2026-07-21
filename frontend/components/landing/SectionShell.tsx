"use client";

import type { ReactNode } from "react";
import { Reveal } from "./Reveal";
import styles from "./SectionShell.module.css";

/**
 * Consistent section frame: label → title → lede, then content.
 * Keeps vertical rhythm and heading scale identical across the landing page.
 */
export function SectionShell({
  id,
  label,
  title,
  lede,
  children,
  tone = "default",
  align = "start",
}: {
  id: string;
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  /** `panel` sets a recessed background to break up the page rhythm. */
  tone?: "default" | "panel";
  align?: "start" | "center";
}) {
  return (
    <section className={styles.section} id={id} data-tone={tone}>
      <div className={styles.container}>
        <Reveal
          className={`${styles.head} ${align === "center" ? styles.headCenter : ""}`}
        >
          <p className="section-label">{label}</p>
          <h2 className={styles.title}>{title}</h2>
          {lede ? <p className={styles.lede}>{lede}</p> : null}
        </Reveal>
        {children}
      </div>
    </section>
  );
}
