"use client";

import Link from "next/link";
import { m, useReducedMotion } from "framer-motion";
import { EASE_OUT, viewportOnce } from "@/lib/motion";
import styles from "./CTASection.module.css";

export function CTASection() {
  const reduced = useReducedMotion() ?? false;

  return (
    <section className={styles.section} id="cta">
      <div className={styles.glow} aria-hidden="true" />
      <m.div
        className={styles.container}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        <h2 className={styles.heading}>
          The decision already happens. Make it visible.
        </h2>
        <p className={styles.lede}>
          Run the full loop — a plant going critical, an assessment that
          explains why, a decision on the record and the report that follows it.
        </p>
        <div className={styles.actions}>
          <Link href="/login" className="btn btn-primary">
            Launch the demo
          </Link>
          <a href="#how" className="btn">
            How it works
          </a>
        </div>
      </m.div>
    </section>
  );
}
