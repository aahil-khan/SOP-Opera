"use client";

import Link from "next/link";
import styles from "./CTASection.module.css";

export function CTASection() {
  return (
    <section className={styles.section} id="cta">
      <div className={styles.container}>
        <h2 className={styles.heading}>
          Safer decisions begin before work starts.
        </h2>
        <div className={styles.actions}>
          <Link href="/" className="btn btn-primary">
            Launch Demo
          </Link>
          <a href="#how-it-works" className="btn">
            View Documentation
          </a>
        </div>
        <p className={styles.foot}>Built for Industrial Operations.</p>
      </div>
    </section>
  );
}
